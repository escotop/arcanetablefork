import uniqBy from 'lodash-es/uniqBy';
import { CardEntryDetail, DetailedCardEntry } from './constants';
import { applyCustomArtToEntry } from './customCardArt';
import { getDeckStore } from './deckStore';
import { loadGameMeta } from './gameMeta';
import type { PlayArea } from './playArea';
import { getCachedCardById, setCachedCardDetail } from './scryfallCache';
import { mapScryfallCard, postCardCollection } from './scryfall/client';

type TokenSource = { id?: string; detail?: { all_parts?: CardEntryDetail['all_parts']; id?: string } };

type TokenDetail = CardEntryDetail & { oracle_id?: string };

const COLLECTION_BATCH_SIZE = 75;

function parentCardId(source: TokenSource): string | undefined {
  return source.detail?.id?.trim() || source.id?.trim() || undefined;
}

export function getTokenKey(detail: TokenDetail) {
  return detail.oracle_id ?? detail.id ?? detail.name;
}

export function tokenDetailToEntry(token: CardEntryDetail): DetailedCardEntry {
  return {
    id: token.id,
    name: token.name,
    qty: 1,
    set: token.set ?? '',
    collector_number: token.collector_number,
    categories: [],
    detail: token,
  };
}

export function getDefaultTokenEntry(
  tokenKey: string,
  defaults: CardEntryDetail[] | undefined,
): DetailedCardEntry | undefined {
  const token = defaults?.find(entry => getTokenKey(entry as TokenDetail) === tokenKey);
  return token ? tokenDetailToEntry(token) : undefined;
}

export function tokenPartId(part: { id?: string; uri?: string }): string | undefined {
  if (part.id?.trim()) return part.id.trim();
  const uri = part.uri?.trim();
  if (!uri) return undefined;
  const match = uri.match(/\/cards\/([0-9a-f-]{36})/i);
  return match?.[1];
}

export function collectTokenPartIds(sources: TokenSource[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const part of source.detail?.all_parts ?? []) {
      if (part.component !== 'token') continue;
      const id = tokenPartId(part);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function sourceHasTokenParts(source: TokenSource) {
  return (source.detail?.all_parts ?? []).some(part => part.component === 'token' && tokenPartId(part));
}

export function collectParentCardIdsForTokenLookup(sources: TokenSource[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    if (sourceHasTokenParts(source)) continue;
    const parentId = parentCardId(source);
    if (parentId) ids.add(parentId);
  }
  return [...ids];
}

async function fetchCardDetailsByIds(ids: string[]): Promise<CardEntryDetail[]> {
  if (!ids.length) return [];

  const results: CardEntryDetail[] = [];
  const needsNetwork: string[] = [];

  for (const id of ids) {
    const cached = await getCachedCardById(id);
    if (cached?.all_parts?.some(part => part.component === 'token')) {
      results.push(cached);
      continue;
    }
    needsNetwork.push(id);
  }

  for (let index = 0; index < needsNetwork.length; index += COLLECTION_BATCH_SIZE) {
    const batch = needsNetwork.slice(index, index + COLLECTION_BATCH_SIZE);
    const body = await postCardCollection(batch.map(id => ({ id })));
    for (const raw of body.data ?? []) {
      const mapped = mapScryfallCard(raw as Record<string, unknown>);
      results.push(mapped);
      void setCachedCardDetail(mapped);
    }
  }

  return results;
}

export async function resolveTokenPartIdsFromSources(sources: TokenSource[]): Promise<string[]> {
  const ids = new Set(collectTokenPartIds(sources));
  const parentIds = collectParentCardIdsForTokenLookup(sources);
  if (parentIds.length) {
    const parents = await fetchCardDetailsByIds(parentIds);
    for (const parent of parents) {
      for (const part of parent.all_parts ?? []) {
        if (part.component !== 'token') continue;
        const id = tokenPartId(part);
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

async function fetchTokenDetailsByIds(ids: string[]): Promise<CardEntryDetail[]> {
  if (!ids.length) return [];

  const resolved: CardEntryDetail[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    const cached = await getCachedCardById(id);
    if (cached?.name && Object.keys(cached.image_uris ?? {}).length > 0) {
      resolved.push(cached);
    } else {
      missing.push(id);
    }
  }

  for (let index = 0; index < missing.length; index += COLLECTION_BATCH_SIZE) {
    const batch = missing.slice(index, index + COLLECTION_BATCH_SIZE);
    const body = await postCardCollection(batch.map(id => ({ id })));
    for (const raw of body.data ?? []) {
      const mapped = mapScryfallCard(raw as Record<string, unknown>);
      resolved.push(mapped);
      void setCachedCardDetail(mapped);
    }
  }

  return resolved;
}

export async function resolveTokensByIds(ids: string[]): Promise<CardEntryDetail[]> {
  if (!ids.length) return [];

  const tokens = await fetchTokenDetailsByIds(ids);

  return uniqBy(
    tokens.filter((token): token is CardEntryDetail => token !== null),
    token => getTokenKey(token as TokenDetail),
  ).sort((a, b) => a.name.localeCompare(b.name));
}

export function findSavedTokenOverride(
  key: string,
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry | undefined {
  if (!saved) return undefined;
  if (saved[key]) return saved[key];
  return Object.values(saved).find(entry => getTokenKey(entry.detail) === key);
}

export function mergeTokenPrintings(
  tokens: CardEntryDetail[],
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry[] {
  return tokens.map(token => {
    const key = getTokenKey(token as TokenDetail);
    const override = findSavedTokenOverride(key, saved);
    if (override) {
      return applyCustomArtToEntry({
        ...override,
        qty: override.qty ?? 1,
        name: override.name ?? token.name,
        categories: override.categories ?? [],
        detail: override.detail ?? token,
      });
    }

    return {
      id: token.id,
      name: token.name,
      qty: 1,
      set: token.set ?? '',
      collector_number: token.collector_number,
      categories: [],
      detail: token,
    };
  });
}

export function appendSavedTokenPrintings(
  tokens: DetailedCardEntry[],
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry[] {
  if (!saved) return tokens;

  const merged = [...tokens];
  const mergedKeys = new Set(merged.map(token => getTokenKey(token.detail as TokenDetail)));

  for (const savedEntry of Object.values(saved)) {
    const key = getTokenKey(savedEntry.detail as TokenDetail);
    if (mergedKeys.has(key)) continue;
    merged.push(
      applyCustomArtToEntry({
        ...savedEntry,
        qty: 1,
        name: savedEntry.name ?? savedEntry.detail.name,
        categories: savedEntry.categories ?? [],
        detail: savedEntry.detail,
      }),
    );
    mergedKeys.add(key);
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

export function restorePlayAreaTokenPrintings(
  playArea: PlayArea,
  gameId?: string,
  snapshotTokens?: Record<string, DetailedCardEntry>,
) {
  const merged: Record<string, DetailedCardEntry> = {};

  if (gameId) {
    const deckId = loadGameMeta(gameId)?.deckId;
    const deckTokens = deckId ? getDeckStore().decks[deckId]?.tokens : undefined;
    if (deckTokens) Object.assign(merged, deckTokens);
  }

  if (snapshotTokens) Object.assign(merged, snapshotTokens);
  if (playArea.tokenPrintings) Object.assign(merged, playArea.tokenPrintings);

  playArea.tokenPrintings = Object.keys(merged).length > 0 ? merged : undefined;
}

/** Resolve display-ready tokens for cards/tokens in play or in a deck list. */
export async function resolveTokensForSources(sources: TokenSource[]): Promise<CardEntryDetail[]> {
  const ids = await resolveTokenPartIdsFromSources(sources);
  return resolveTokensByIds(ids);
}
