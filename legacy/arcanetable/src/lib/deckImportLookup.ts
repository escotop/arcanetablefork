import { CardEntry, CardEntryDetail, DetailedCardEntry, isMagicCardSystem } from './constants';
import { fetchCardInfo, populateCardInfo } from './deck';
import { hasRequestedPrinting } from './deckPrinting';
import { getCardKey } from './deckStore';
import { devLog } from './devLog';
import { cardSystem } from './globals';

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const COLLECTION_CHUNK_SIZE = 75;
const COLLECTION_CHUNK_DELAY_MS = 120;
const INDIVIDUAL_LOOKUP_DELAY_MS = 120;

type CollectionIdentifier = { name: string } | { set: string; collector_number: string };

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

function mapProxyImageUris(
  cardName: string,
  imageUris: Record<string, string> | undefined,
  baseUrl: string,
) {
  const normal = imageUris?.normal ?? imageUris?.large ?? imageUris?.small;
  const crop = imageUris?.art_crop;

  if (!baseUrl) {
    return imageUris ?? { full: {}, art: {} };
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
      uri: baseUrl ? `${baseUrl}/cards/named?id=${part.id}` : part.uri,
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

async function resolveNamesViaCollection(names: string[]) {
  const resolvedByName = new Map<string, CardEntryDetail>();

  for (let index = 0; index < names.length; index += COLLECTION_CHUNK_SIZE) {
    const chunk = names.slice(index, index + COLLECTION_CHUNK_SIZE);
    const identifiers = chunk.map(name => ({ name }));
    const body = await postCollection(identifiers);

    if (!body) {
      devLog.warn('[deck import] Collection chunk failed for', chunk.length, 'cards');
      continue;
    }

    for (const requestedName of chunk) {
      const rawCard = (body.data ?? []).find(card => cardNamesMatch(String(card.name), requestedName));
      if (rawCard) {
        resolvedByName.set(normalizeCardName(requestedName), mapScryfallCardForDeck(rawCard));
      }
    }

    if (index + COLLECTION_CHUNK_SIZE < names.length) {
      await delay(COLLECTION_CHUNK_DELAY_MS);
    }
  }

  return resolvedByName;
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
  return isMagicCardSystem(cardSystem) && entries.some(entry => !entry.id && !hasRequestedPrinting(entry));
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

  const batchable = entries.filter(entry => !entry.id && !hasRequestedPrinting(entry));
  const individual = entries.filter(entry => entry.id || hasRequestedPrinting(entry));

  const uniqueNames = [...new Set(batchable.map(entry => normalizeCardName(entry.name)))];
  const resolvedByName = canUseBatchImport(entries)
    ? await resolveNamesViaCollection(
        uniqueNames.map(name => batchable.find(entry => normalizeCardName(entry.name) === name)!.name),
      )
    : new Map<string, CardEntryDetail>();

  const missingAfterBatch: CardEntry[] = [];

  for (const entry of batchable) {
    const payload = resolvedByName.get(normalizeCardName(entry.name));
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

  const pendingIndividual = [...individual, ...missingAfterBatch];
  const individualKeys = new Set(individual.map(entry => getCardKey(entry)));

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
