import type { CardEntryDetail } from '../constants';
import type { ScryfallSearchResult } from '../scryfall/client';

const MTG_API_BASE = 'https://api.magicthegathering.io/v1';
/** MTG API max is 100; large `name` queries are more reliable at 50. */
const PAGE_SIZE = 50;
/** Name lookups answer in ~0.3-0.6 s; type-only searches can take 15 s+, so cap them. */
const NAME_TIMEOUT_MS = 8_000;
const BROWSE_TIMEOUT_MS = 10_000;
/** The API allows 1000 requests per hour per IP (Ratelimit-Limit header). */
const RATE_LIMITED_PAUSE_MS = 10 * 60_000;

/** Marks card details that came from this stopgap provider (not cached long-term). */
export const MTG_API_DATA_SOURCE = 'mtgapi';

export function isFallbackCardDetail(detail: unknown): boolean {
  return (detail as { dataSource?: string } | undefined)?.dataSource === MTG_API_DATA_SOURCE;
}

let pausedUntil = 0;

export function isMtgApiAvailable(now = Date.now()) {
  return now >= pausedUntil;
}

/** @internal Test hook. */
export function resetMtgApiStateForTests() {
  pausedUntil = 0;
}

const CATALOG_TYPE_TO_MTG: Record<string, string> = {
  creature: 'Creature',
  land: 'Land',
  instant: 'Instant',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  sorcery: 'Sorcery',
  planeswalker: 'Planeswalker',
};

interface MtgApiCard {
  id?: string;
  name?: string;
  manaCost?: string;
  type?: string;
  text?: string;
  flavor?: string;
  set?: string;
  setName?: string;
  number?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  multiverseid?: number;
  imageUrl?: string;
  rarity?: string;
}

interface MtgApiCardsResponse {
  cards?: MtgApiCard[];
}

function normalizeGathererImageUrl(url?: string) {
  if (!url) return undefined;
  return url.replace(/^http:\/\//i, 'https://');
}

export function mapMtgApiCardToDetail(card: MtgApiCard): CardEntryDetail {
  const image = normalizeGathererImageUrl(card.imageUrl);
  const imageUris = image
    ? {
        normal: image,
        large: image,
        small: image,
        png: image,
      }
    : {};

  return {
    name: card.name ?? '',
    set: card.set?.toLowerCase(),
    collector_number: card.number,
    type_line: card.type ?? '',
    type: card.type ?? '',
    mana_cost: card.manaCost,
    oracle_text: card.text,
    effect: card.text ?? '',
    flavor: card.flavor ?? '',
    image_uris: imageUris,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    set_name: card.setName,
    search: '',
    popularity: 99999,
    dataSource: MTG_API_DATA_SOURCE,
  } as CardEntryDetail;
}

function dedupeByCardName(cards: CardEntryDetail[]) {
  const seen = new Set<string>();
  const unique: CardEntryDetail[] = [];
  for (const card of cards) {
    const key = card.name?.trim().toLowerCase() ?? '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
  }
  return unique.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

function buildMtgApiSearchParams(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number },
) {
  const params = new URLSearchParams();
  const page = options.page ?? 1;
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  params.set('contains', 'imageUrl');
  // Do not set orderBy=name — the upstream API returns HTTP 500 for many name searches.

  const trimmed = q.trim();
  if (trimmed) {
    params.set('name', trimmed);
  }

  const mtgTypes = (options.types ?? [])
    .map(type => CATALOG_TYPE_TO_MTG[type.toLowerCase()] ?? type)
    .filter(Boolean);
  if (mtgTypes.length === 1) {
    params.set('types', mtgTypes[0]);
  } else if (mtgTypes.length > 1) {
    params.set('types', mtgTypes.join('|'));
  }

  const subtypes = (options.subtypes ?? []).map(s => s.trim()).filter(Boolean);
  if (subtypes.length) {
    params.set('subtypes', subtypes.join(','));
  }

  return params;
}

function buildMtgApiFallbackParams(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number },
) {
  const params = buildMtgApiSearchParams(q, options);
  params.delete('contains');
  return params;
}

async function fetchMtgApiSearch(params: URLSearchParams) {
  if (!isMtgApiAvailable()) throw new Error('MTG API rate limit exceeded');
  const url = `${MTG_API_BASE}/cards?${params}`;
  const timeoutMs = params.get('name') ? NAME_TIMEOUT_MS : BROWSE_TIMEOUT_MS;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const remaining = Number(response.headers.get('Ratelimit-Remaining'));
  if (response.status === 403 || response.status === 429 || (Number.isFinite(remaining) && remaining <= 0 && response.headers.has('Ratelimit-Remaining'))) {
    pausedUntil = Date.now() + RATE_LIMITED_PAUSE_MS;
  }
  return response;
}

function cardHasDisplayImage(card: MtgApiCard) {
  return Boolean(normalizeGathererImageUrl(card.imageUrl));
}

/**
 * Deck-editor catalog search via [MTG API](https://docs.magicthegathering.io/).
 * Last-resort fallback: 1000 req/h per IP, no Scryfall ids, Gatherer images.
 */
export async function searchMtgApiCards(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
): Promise<ScryfallSearchResult> {
  const page = options.page ?? 1;
  const params = buildMtgApiSearchParams(q, options);
  let response = await fetchMtgApiSearch(params);

  if (response.status === 500) {
    response = await fetchMtgApiSearch(buildMtgApiFallbackParams(q, options));
  }

  if (response.status === 403 || response.status === 429) {
    throw new Error('MTG API rate limit exceeded');
  }
  if (!response.ok) {
    throw new Error(`MTG API search failed (${response.status})`);
  }

  const body = (await response.json()) as MtgApiCardsResponse;
  const withImages = (body.cards ?? []).filter(cardHasDisplayImage);
  const mapped = dedupeByCardName(withImages.map(mapMtgApiCardToDetail));

  const totalCount = parseInt(response.headers.get('Total-Count') ?? '0', 10);
  const pageSize = parseInt(response.headers.get('Page-Size') ?? String(PAGE_SIZE), 10) || PAGE_SIZE;
  const totalPages =
    totalCount > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : page;

  return {
    id: 'mtgapi',
    object: 'list',
    page,
    total_cards: totalCount || mapped.length,
    total_pages: totalPages,
    data: mapped,
  };
}

function pickMtgApiPrinting(cards: MtgApiCard[], entry: { set?: string; collector_number?: string }) {
  if (!cards.length) return undefined;

  const set = entry.set?.trim().toLowerCase();
  const collector = entry.collector_number?.trim();

  if (set && collector) {
    const exact = cards.find(
      card =>
        card.set?.toLowerCase() === set &&
        String(card.number ?? '').toLowerCase() === collector.toLowerCase(),
    );
    if (exact) return exact;
  }

  if (set) {
    const bySet = cards.find(card => card.set?.toLowerCase() === set);
    if (bySet) return bySet;
  }

  return cards.find(card => cardHasDisplayImage(card)) ?? cards[0];
}

/** Resolve one deck entry while Scryfall is in fallback mode. */
export async function lookupMtgApiCardEntry(entry: {
  name: string;
  set?: string;
  collector_number?: string;
}): Promise<CardEntryDetail | null> {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('pageSize', '100');
  params.set('name', entry.name.trim());
  if (entry.set?.trim()) {
    params.set('set', entry.set.trim());
  }

  let response = await fetchMtgApiSearch(params);
  if (response.status === 500) {
    params.delete('contains');
    response = await fetchMtgApiSearch(params);
  }
  if (!response.ok) return null;

  let body = (await response.json()) as MtgApiCardsResponse;
  if (!body.cards?.length && params.has('set')) {
    // Set codes do not always match Scryfall's; any printing beats "not found".
    params.delete('set');
    const retry = await fetchMtgApiSearch(params);
    if (retry.ok) body = (await retry.json()) as MtgApiCardsResponse;
  }
  const match = pickMtgApiPrinting(body.cards ?? [], entry);
  if (!match) return null;
  return mapMtgApiCardToDetail(match);
}
