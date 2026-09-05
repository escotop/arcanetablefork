import { CardEntry, CardEntryDetail, DetailedCardEntry, isMagicCardSystem } from './constants';
import { fetchCardInfo, populateCardInfo } from './deck';
import {
  hasRequestedPrinting,
  normalizePrintingCollectorNumber,
  normalizePrintingSetCode,
} from './deckPrinting';
import { getCardKey } from './deckStore';
import { devLog } from './devLog';
import { cardSystem } from './globals';

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const COLLECTION_CHUNK_SIZE = 75;
const COLLECTION_CHUNK_DELAY_MS = 120;
const INDIVIDUAL_LOOKUP_DELAY_MS = 120;

type CollectionIdentifier =
  | { id: string }
  | { name: string }
  | { set: string; collector_number: string };

interface ScryfallCollectionResponse {
  object?: string;
  data?: Array<Record<string, unknown>>;
  not_found?: CollectionIdentifier[];
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeCardName(name?: string) {
  return name?.trim().toLowerCase() || '';
}

function cardNamesMatch(cardName: string | undefined, requestedName: string) {
  const left = normalizeCardName(cardName);
  const right = normalizeCardName(requestedName);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftFront = left.split('//')[0]?.trim() ?? left;
  const rightFront = right.split('//')[0]?.trim() ?? right;
  return leftFront === rightFront || leftFront === right || left === rightFront;
}

function getCardSystemBaseUrl() {
  const uri = cardSystem.uri?.replace(/\/$/, '');
  if (uri) return uri;

  try {
    return new URL(cardSystem.cardDetailEndpoint).origin;
  } catch {
    return '';
  }
}

function usesLegacyDeckImageProxy(baseUrl: string) {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname !== 'api.scryfall.com';
  } catch {
    return true;
  }
}

function mapProxyImageUris(
  cardName: string,
  imageUris: Record<string, string> | undefined,
  baseUrl: string,
) {
  const normal = imageUris?.normal ?? imageUris?.large ?? imageUris?.small;
  const crop = imageUris?.art_crop;

  if (!usesLegacyDeckImageProxy(baseUrl)) {
    return imageUris ?? {};
  }

  return {
    full: normal
      ? { [cardName]: `${baseUrl}/card_images/?uri=${encodeURIComponent(normal)}` }
      : {},
    art: crop ? { [cardName]: `${baseUrl}/card_art/?uri=${encodeURIComponent(crop)}` } : {},
  };
}

export function mapScryfallCardForDeck(card: Record<string, unknown>): CardEntryDetail {
  const baseUrl = getCardSystemBaseUrl();
  const name = String(card.name ?? '');
  const cardFaces = (card.card_faces as Array<Record<string, unknown>> | undefined) ?? [];

  const mappedFaces = cardFaces.map(face => {
    const faceName = String(face.name ?? name);
    return {
      ...face,
      image_uris: mapProxyImageUris(
        faceName,
        face.image_uris as Record<string, string> | undefined,
        baseUrl,
      ),
    };
  });

  const { image_uris: _iu, card_faces: _cf, ...rest } = card;

  return {
    ...(rest as CardEntryDetail),
    name,
    type: ((card.type_line as string) ?? '').replace(/^Summon\b/i, 'Creature —'),
    type_line: card.type_line as string,
    effect: (card.oracle_text as string) ?? '',
    flavor: (card.flavor_text as string) ?? '',
    image_uris: mapProxyImageUris(name, card.image_uris as Record<string, string> | undefined, baseUrl),
    card_faces: mappedFaces as CardEntryDetail['card_faces'],
    all_parts: ((card.all_parts as Array<Record<string, unknown>>) ?? []).map(part => ({
      ...part,
      uri: baseUrl ? `${baseUrl}/cards/${part.id}` : part.uri,
    })),
  } as CardEntryDetail;
}

async function postCollection(
  identifiers: CollectionIdentifier[],
): Promise<ScryfallCollectionResponse | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(SCRYFALL_COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });

    if (response.status === 429 || response.status === 503) {
      await delay(400 * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      devLog.warn('[deck import] Collection request failed:', response.status);
      return null;
    }

    return (await response.json()) as ScryfallCollectionResponse;
  }

  return null;
}

function getBatchIdentifier(entry: CardEntry): CollectionIdentifier | null {
  if (entry.id) {
    return { id: entry.id };
  }

  const set = normalizePrintingSetCode(entry.set);
  const collector = normalizePrintingCollectorNumber(entry.collector_number);
  if (set && collector) {
    return { set, collector_number: collector };
  }

  if (entry.name && !hasRequestedPrinting(entry)) {
    return { name: entry.name };
  }

  return null;
}

function identifierKey(identifier: CollectionIdentifier) {
  if ('id' in identifier) return `id:${identifier.id}`;
  if ('set' in identifier) return `set:${identifier.set}:${identifier.collector_number}`;
  return `name:${normalizeCardName(identifier.name)}`;
}

function findCardForEntry(entry: CardEntry, data: Array<Record<string, unknown>>) {
  if (entry.id) {
    const byId = data.find(card => String(card.id) === entry.id);
    if (byId) return byId;
  }

  const set = normalizePrintingSetCode(entry.set);
  const collector = normalizePrintingCollectorNumber(entry.collector_number);
  if (set && collector) {
    const byPrinting = data.find(
      card =>
        normalizePrintingSetCode(String(card.set)) === set &&
        normalizePrintingCollectorNumber(String(card.collector_number)) === collector,
    );
    if (byPrinting) return byPrinting;
  }

  return data.find(card => cardNamesMatch(String(card.name), entry.name));
}

async function resolveEntriesViaCollection(entries: CardEntry[]) {
  const resolved = new Map<string, CardEntryDetail>();
  if (!entries.length) return resolved;

  const identifiersByKey = new Map<string, CollectionIdentifier>();
  for (const entry of entries) {
    const identifier = getBatchIdentifier(entry);
    if (!identifier) continue;
    identifiersByKey.set(identifierKey(identifier), identifier);
  }

  const identifiers = [...identifiersByKey.values()];
  const entriesByIdentifierKey = new Map<string, CardEntry[]>();
  for (const entry of entries) {
    const identifier = getBatchIdentifier(entry);
    if (!identifier) continue;
    const key = identifierKey(identifier);
    const bucket = entriesByIdentifierKey.get(key) ?? [];
    bucket.push(entry);
    entriesByIdentifierKey.set(key, bucket);
  }

  for (let index = 0; index < identifiers.length; index += COLLECTION_CHUNK_SIZE) {
    const chunk = identifiers.slice(index, index + COLLECTION_CHUNK_SIZE);
    const chunkKeys = new Set(chunk.map(identifierKey));
    const body = await postCollection(chunk);

    if (!body) {
      devLog.warn('[deck import] Collection chunk failed for', chunk.length, 'cards');
      continue;
    }

    for (const key of chunkKeys) {
      for (const entry of entriesByIdentifierKey.get(key) ?? []) {
        const entryKey = getCardKey(entry);
        if (resolved.has(entryKey)) continue;

        const rawCard = findCardForEntry(entry, body.data ?? []);
        if (rawCard) {
          resolved.set(entryKey, mapScryfallCardForDeck(rawCard));
        }
      }
    }

    if (index + COLLECTION_CHUNK_SIZE < identifiers.length) {
      await delay(COLLECTION_CHUNK_DELAY_MS);
    }
  }

  return resolved;
}

function buildDetailedEntry(entry: CardEntry, payload: CardEntryDetail): DetailedCardEntry {
  const populated = populateCardInfo(payload, entry);
  return {
    ...entry,
    ...populated,
    set: entry.set,
    collector_number: entry.collector_number,
  };
}

function notFoundEntry(entry: CardEntry, reason: string): DetailedCardEntry {
  return {
    ...entry,
    found: false,
    importLookupReason: reason,
    detail: { name: entry.name } as CardEntryDetail,
  };
}

export function canUseBatchImport(entries: CardEntry[]) {
  return isMagicCardSystem(cardSystem) && entries.some(entry => getBatchIdentifier(entry) !== null);
}

function findResolvedImportCard(
  entry: CardEntry,
  cards: Record<string, DetailedCardEntry>,
) {
  return (
    cards[getCardKey(entry)] ??
    Object.values(cards).find(
      card =>
        card.name === entry.name &&
        (!entry.set ||
          normalizePrintingSetCode(card.set) === normalizePrintingSetCode(entry.set)),
    )
  );
}

export function buildImportedInPlay(
  entries: CardEntry[],
  inPlayIndices: number[],
  cards: Record<string, DetailedCardEntry>,
) {
  const inPlay: Record<string, DetailedCardEntry> = {};

  for (const index of inPlayIndices) {
    const entry = entries[index];
    if (!entry) continue;

    const resolved = findResolvedImportCard(entry, cards);
    if (resolved) {
      inPlay[getCardKey(resolved)] = resolved;
    }
  }

  return inPlay;
}

export async function fetchCardInfoForImport(
  entries: CardEntry[],
  cache?: Map<string, DetailedCardEntry>,
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<Record<string, DetailedCardEntry>> {
  const cards: Record<string, DetailedCardEntry> = {};
  const total = entries.length;
  let current = 0;

  const report = (name: string) => {
    current++;
    onProgress?.(current, total, name);
  };

  const batchable = canUseBatchImport(entries)
    ? entries.filter(entry => getBatchIdentifier(entry) !== null)
    : [];
  const nonBatchable = entries.filter(entry => getBatchIdentifier(entry) === null);

  const resolvedByEntryKey = await resolveEntriesViaCollection(batchable);
  const missingAfterBatch: CardEntry[] = [];

  for (const entry of batchable) {
    const payload = resolvedByEntryKey.get(getCardKey(entry));
    if (payload) {
      const detailed = buildDetailedEntry(entry, payload);
      cards[getCardKey(detailed)] = detailed;
      if (cache) {
        cache.set(getCardKey(detailed), detailed);
      }
    } else {
      missingAfterBatch.push(entry);
    }
    report(entry.name);
  }

  const pendingIndividual = [...nonBatchable, ...missingAfterBatch];
  const individualKeys = new Set(nonBatchable.map(entry => getCardKey(entry)));

  for (let index = 0; index < pendingIndividual.length; index++) {
    const entry = pendingIndividual[index];
    if (index > 0) {
      await delay(INDIVIDUAL_LOOKUP_DELAY_MS);
    }

    const card = await fetchCardInfo(entry, cache);
    cards[getCardKey(card)] = card;

    if (individualKeys.has(getCardKey(entry))) {
      report(entry.name);
    }
  }

  return cards;
}
