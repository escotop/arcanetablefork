import type { CardEntryDetail } from '../constants';

const SCRYFALL_API = '/api/scryfall';

/**
 * Scryfall documents hard per-endpoint limits: `/cards/search`, `/cards/named` and
 * `/cards/collection` are capped at 2 req/s (500 ms). Single-card lookups by id or
 * set/collector have no specific documented limit, so they can go a bit faster.
 */
const STRICT_ENDPOINT_INTERVAL_MS = 500;
const DEFAULT_ENDPOINT_INTERVAL_MS = 110;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 8_000;
const REQUEST_TIMEOUT_MS = 20_000;

function isStrictEndpoint(path: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method === 'POST' && /^\/cards\/collection\/?$/.test(path)) return true;
  return /^\/cards\/(search|named)(\/|\?|$)/.test(path);
}

function retryDelayMs(response: Response, attempt: number) {
  const header = response.headers.get('Retry-After');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(MAX_RETRY_DELAY_MS, seconds * 1000);
    }
    const at = Date.parse(header);
    if (Number.isFinite(at)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, at - Date.now()));
    }
  }
  const base = 600 * 2 ** attempt;
  const jitter = Math.random() * 300;
  return Math.min(MAX_RETRY_DELAY_MS, base + jitter);
}

const TYPE_ALIASES: Record<string, string> = {
  creature: '(t:creature or t:summon)',
  land: '(t:land)',
  instant: '(t:instant or t:interrupt)',
  artifact: 't:artifact',
  enchantment: 't:enchantment',
  sorcery: 't:sorcery',
  planeswalker: 't:planeswalker',
};

let lastRequestAt = 0;
let scryfallFetchChain: Promise<unknown> = Promise.resolve();

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scryfallFetchInner(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${SCRYFALL_API}${path}`;
  const relativePath = path.startsWith('http') ? new URL(path).pathname : path;
  const interval = isStrictEndpoint(relativePath, init)
    ? STRICT_ENDPOINT_INTERVAL_MS
    : DEFAULT_ENDPOINT_INTERVAL_MS;
  let response: Response | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = Date.now();
    const wait = Math.max(0, interval - (now - lastRequestAt));
    if (wait) await delay(wait);
    lastRequestAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(init?.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status !== 429 && response.status !== 503) return response;
    if (attempt === MAX_ATTEMPTS - 1) break;

    const backoff = retryDelayMs(response, attempt);
    await delay(backoff);
    // Make sure the next request in the queue also waits out the penalty window.
    lastRequestAt = Date.now();
  }

  return response!;
}

/** Shared serial queue for every Scryfall request issued by the app. */
export async function scryfallFetch(path: string, init?: RequestInit): Promise<Response> {
  const next = scryfallFetchChain.then(() => scryfallFetchInner(path, init));
  scryfallFetchChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function mapScryfallCard(card: Record<string, unknown>): CardEntryDetail {
  const popularity =
    typeof card.edhrec_rank === 'number'
      ? card.edhrec_rank
      : typeof card.edhrec_rank === 'string'
        ? Number(card.edhrec_rank)
        : 99999;

  return {
    ...(card as CardEntryDetail),
    id: String(card.id ?? ''),
    name: String(card.name ?? ''),
    set: card.set as string | undefined,
    collector_number: card.collector_number as string | undefined,
    lang: card.lang as string | undefined,
    type_line: String(card.type_line ?? ''),
    image_uris: (card.image_uris as Record<string, string>) ?? {},
    card_faces: (card.card_faces as CardEntryDetail['card_faces']) ?? undefined,
    all_parts: (card.all_parts as CardEntryDetail['all_parts'])?.map(part => ({
      ...part,
      uri: part.uri ?? `${SCRYFALL_API}/cards/${part.id}`,
    })),
    popularity,
    search: '',
  };
}

export async function getCardById(id: string): Promise<CardEntryDetail | null> {
  const res = await scryfallFetch(`/cards/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const card = await res.json();
  if (card?.object === 'error') return null;
  return mapScryfallCard(card);
}

export async function getCardNamed(
  exact: string,
  options: { set?: string; id?: string } = {},
): Promise<CardEntryDetail | null> {
  if (options.id) {
    return getCardById(options.id);
  }

  const params = new URLSearchParams({ exact });
  if (options.set) params.set('set', options.set);

  const res = await scryfallFetch(`/cards/named?${params}`);
  if (!res.ok) return null;
  const card = await res.json();
  if (card?.object === 'error') return null;
  return mapScryfallCard(card);
}

export async function getCardBySetCollector(
  set: string,
  collectorNumber: string,
): Promise<CardEntryDetail | null> {
  const res = await scryfallFetch(
    `/cards/${encodeURIComponent(set)}/${encodeURIComponent(collectorNumber)}`,
  );
  if (!res.ok) return null;
  const card = await res.json();
  if (card?.object === 'error') return null;
  return mapScryfallCard(card);
}

export interface ScryfallSearchResult {
  id: string;
  object: 'list';
  page: number;
  total_cards: number;
  total_pages: number;
  data: CardEntryDetail[];
}

function formatSubtypeQuery(subtype: string) {
  const trimmed = subtype.trim();
  if (/^[a-z0-9]+$/i.test(trimmed)) {
    return `t:${trimmed}`;
  }
  return `t:"${trimmed.replace(/"/g, '\\"')}"`;
}

function buildSearchQuery(q: string, types: string[] = [], subtypes: string[] = []) {
  const parts: string[] = [];
  if (q?.trim()) parts.push(q.trim());
  if (types.length) {
    let typeQuery = types.map(t => TYPE_ALIASES[t.toLowerCase()] ?? `t:${t}`).join(' or ');
    if (types.length > 1) typeQuery = `(${typeQuery})`;
    parts.push(typeQuery);
  }
  for (const subtype of subtypes) {
    if (subtype.trim()) parts.push(formatSubtypeQuery(subtype));
  }
  return parts.join(' ').trim() || '*';
}

export class ScryfallRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Scryfall request failed (${status})`);
    this.name = 'ScryfallRequestError';
    this.status = status;
    this.body = body;
  }
}

export async function searchCards(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
): Promise<ScryfallSearchResult> {
  const page = options.page ?? 1;
  const params = new URLSearchParams({
    q: buildSearchQuery(q, options.types, options.subtypes),
    order: 'name',
    page: String(page),
  });

  const res = await scryfallFetch(`/cards/search?${params}`);
  const text = await res.text();
  if (res.status === 404) {
    return { id: 'mtgplayer', object: 'list', page, total_cards: 0, total_pages: 0, data: [] };
  }
  if (!res.ok) {
    throw new ScryfallRequestError(res.status, text);
  }

  const list = JSON.parse(text) as {
    total_cards?: number;
    data?: Array<Record<string, unknown>>;
  };
  const totalCards = list.total_cards ?? list.data?.length ?? 0;
  return {
    id: 'mtgplayer',
    object: 'list',
    page,
    total_cards: totalCards,
    total_pages: Math.max(1, Math.ceil(totalCards / 175)),
    data: (list.data ?? []).map((card: Record<string, unknown>) => mapScryfallCard(card)),
  };
}

export const SCRYFALL_COLLECTION_MAX_IDENTIFIERS = 75;

export type ScryfallCollectionIdentifier =
  | { id: string }
  | { name: string }
  | { name: string; set: string }
  | { set: string; collector_number: string };

export interface ScryfallCollectionResponse {
  object?: string;
  data?: Array<Record<string, unknown>>;
  not_found?: ScryfallCollectionIdentifier[];
}

export async function postCardCollection(
  identifiers: ScryfallCollectionIdentifier[],
): Promise<ScryfallCollectionResponse> {
  if (identifiers.length > SCRYFALL_COLLECTION_MAX_IDENTIFIERS) {
    throw new Error(
      `Scryfall collection accepts at most ${SCRYFALL_COLLECTION_MAX_IDENTIFIERS} identifiers`,
    );
  }
  const res = await scryfallFetch('/cards/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers }),
  });
  if (!res.ok) throw new Error(`Scryfall collection failed (${res.status})`);
  return res.json();
}

/**
 * Fetch many cards by Scryfall id using `/cards/collection` in chunks of 75.
 * Returns raw card objects; ids that Scryfall does not know are simply absent.
 */
export async function fetchCardsByIds(ids: string[]): Promise<Array<Record<string, unknown>>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const cards: Array<Record<string, unknown>> = [];
  for (let index = 0; index < unique.length; index += SCRYFALL_COLLECTION_MAX_IDENTIFIERS) {
    const batch = unique.slice(index, index + SCRYFALL_COLLECTION_MAX_IDENTIFIERS);
    const body = await postCardCollection(batch.map(id => ({ id })));
    cards.push(...(body.data ?? []));
  }
  return cards;
}
