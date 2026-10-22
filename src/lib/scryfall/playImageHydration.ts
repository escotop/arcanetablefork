import type { CardEntry, CardEntryDetail } from '../constants';
import {
  fetchCardsByIds,
  getCardNamed,
  mapScryfallCard,
  postCardCollection,
  SCRYFALL_COLLECTION_MAX_IDENTIFIERS,
  type ScryfallCollectionIdentifier,
} from './client';
import { getCachedCardById, getCachedCardDetail, setCachedCardDetail } from '../scryfallCache';

const FLUSH_DELAY_MS = 50;

type HydrationTarget = {
  key: string;
  readDetail: () => CardEntryDetail;
  writeDetail: (detail: CardEntryDetail) => void;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const pendingByKey = new Map<string, HydrationTarget>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushChain: Promise<void> = Promise.resolve();

function detailHasPlayableImage(detail: CardEntryDetail | undefined) {
  if (!detail) return false;
  const uris = detail.image_uris;
  if (uris?.normal || uris?.large || uris?.png || uris?.small) return true;
  return detail.card_faces?.some(face => {
    const faceUris = face.image_uris;
    return faceUris?.normal || faceUris?.large || faceUris?.png || faceUris?.small;
  });
}

export function playCardImageHydrationKey(detail: CardEntryDetail) {
  if (detail.id) return detail.id;
  return `${detail.name ?? 'unknown'}:${detail.set ?? ''}:${detail.collector_number ?? ''}`;
}

function entryFromDetail(detail: CardEntryDetail): CardEntry {
  return {
    name: detail.name ?? '',
    id: detail.id,
    set: detail.set,
    collector_number: detail.collector_number,
    qty: 1,
    categories: [],
  };
}

function mergeHydratedDetail(
  previous: CardEntryDetail,
  payload: CardEntryDetail,
): CardEntryDetail {
  const merged = { ...previous, ...payload };
  merged.search = merged.search ?? payload.search ?? previous.search ?? '';
  return merged;
}

function cardMatchesTarget(detail: CardEntryDetail, mapped: CardEntryDetail) {
  if (detail.id && mapped.id) return detail.id === mapped.id;
  if (!detail.name || !mapped.name) return false;
  if (detail.name.toLowerCase() !== mapped.name.toLowerCase()) return false;
  if (detail.set && mapped.set && detail.set.toLowerCase() !== mapped.set.toLowerCase()) {
    return false;
  }
  return true;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    flushChain = flushChain.then(() => flushPendingHydration()).catch(() => undefined);
  }, FLUSH_DELAY_MS);
}

async function flushPendingHydration() {
  if (!pendingByKey.size) return;

  const batch = [...pendingByKey.values()];
  pendingByKey.clear();

  const stillNeeding: HydrationTarget[] = [];

  for (const target of batch) {
    const detail = target.readDetail();
    if (detailHasPlayableImage(detail)) {
      target.resolve();
      continue;
    }

    const cached =
      (detail.id ? await getCachedCardById(detail.id) : null) ??
      (await getCachedCardDetail(entryFromDetail(detail)));

    if (cached && detailHasPlayableImage(cached)) {
      target.writeDetail(mergeHydratedDetail(detail, cached));
      target.resolve();
      continue;
    }

    stillNeeding.push(target);
  }

  if (!stillNeeding.length) return;

  const idsToFetch = new Set<string>();
  const collectionRows: Array<{ identifier: ScryfallCollectionIdentifier; target: HydrationTarget }> =
    [];

  for (const target of stillNeeding) {
    const detail = target.readDetail();
    if (detail.id) {
      idsToFetch.add(detail.id);
      continue;
    }
    if (detail.name && detail.set) {
      collectionRows.push({ identifier: { name: detail.name, set: detail.set }, target });
      continue;
    }
    if (detail.name) {
      collectionRows.push({ identifier: { name: detail.name }, target });
    }
  }

  const byId = new Map<string, CardEntryDetail>();

  if (idsToFetch.size) {
    const rawCards = await fetchCardsByIds([...idsToFetch]);
    for (const raw of rawCards) {
      const mapped = mapScryfallCard(raw);
      if (mapped.id) byId.set(mapped.id, mapped);
      void setCachedCardDetail(mapped);
    }
  }

  for (const target of stillNeeding) {
    const detail = target.readDetail();
    if (!detail.id) continue;
    const payload = byId.get(detail.id);
    if (!payload) continue;
    target.writeDetail(mergeHydratedDetail(detail, payload));
    target.resolve();
  }

  if (collectionRows.length) {
    try {
      for (let index = 0; index < collectionRows.length; index += SCRYFALL_COLLECTION_MAX_IDENTIFIERS) {
        const chunk = collectionRows.slice(index, index + SCRYFALL_COLLECTION_MAX_IDENTIFIERS);
        const body = await postCardCollection(chunk.map(row => row.identifier));
        for (const raw of body.data ?? []) {
          const mapped = mapScryfallCard(raw as Record<string, unknown>);
          void setCachedCardDetail(mapped);
          for (const row of chunk) {
            const detail = row.target.readDetail();
            if (detailHasPlayableImage(detail)) continue;
            if (!cardMatchesTarget(detail, mapped)) continue;
            row.target.writeDetail(mergeHydratedDetail(detail, mapped));
            row.target.resolve();
          }
        }
      }
    } catch (error) {
      for (const row of collectionRows) {
        row.target.reject(error);
      }
    }
  }

  for (const target of stillNeeding) {
    const detail = target.readDetail();
    if (detailHasPlayableImage(detail)) continue;
    try {
      const payload =
        (detail.id ? byId.get(detail.id) : undefined) ??
        (await getCardNamed(detail.name, { set: detail.set, id: detail.id }));
      if (!payload) {
        target.resolve();
        continue;
      }
      void setCachedCardDetail(payload);
      target.writeDetail(mergeHydratedDetail(detail, payload));
      target.resolve();
    } catch (error) {
      target.reject(error);
    }
  }
}

const inflightByKey = new Map<string, Promise<void>>();

/** Hydrate missing Scryfall image URIs for in-game cards (batched collection + IDB cache). */
export function ensurePlayCardImageHydration(
  key: string,
  readDetail: () => CardEntryDetail,
  writeDetail: (detail: CardEntryDetail) => void,
): Promise<void> {
  if (detailHasPlayableImage(readDetail())) return Promise.resolve();

  const inflight = inflightByKey.get(key);
  if (inflight) return inflight;

  const promise = new Promise<void>((resolve, reject) => {
    pendingByKey.set(key, { key, readDetail, writeDetail, resolve, reject });
    scheduleFlush();
  }).finally(() => {
    inflightByKey.delete(key);
  });

  inflightByKey.set(key, promise);
  return promise;
}
