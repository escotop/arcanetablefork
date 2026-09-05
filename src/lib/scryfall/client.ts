import type { CardEntryDetail } from '../constants';

const SCRYFALL_API = 'https://api.scryfall.com';
const MIN_REQUEST_INTERVAL_MS = 110;

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

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scryfallFetch(path: string, init?: RequestInit): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt));
  if (wait) await delay(wait);
  lastRequestAt = Date.now();

  const url = path.startsWith('http') ? path : `${SCRYFALL_API}${path}`;
  let response: Response | undefined;

  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'untapped-table/0.1',
          ...(init?.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status !== 429 && response.status !== 503) return response;
    await delay(300 * (attempt + 1));
  }

  return response!;
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

function buildSearchQuery(q: string, types: string[] = []) {
  let sfQuery = q ?? '';
  if (types.length) {
    let typeQuery = types.map(t => TYPE_ALIASES[t.toLowerCase()] ?? `t:${t}`).join(' or ');
    if (types.length > 1) typeQuery = `(${typeQuery})`;
    sfQuery = `${sfQuery} ${typeQuery}`.trim();
  }
  return sfQuery.trim() || '*';
}

export async function searchCards(
  q: string,
  options: { types?: string[]; page?: number } = {},
): Promise<ScryfallSearchResult> {
  const page = options.page ?? 1;
  const params = new URLSearchParams({
    q: buildSearchQuery(q, options.types),
    order: 'name',
    page: String(page),
  });

  const res = await scryfallFetch(`/cards/search?${params}`);
  if (res.status === 404) {
    return { id: 'mtgplayer', object: 'list', page, total_cards: 0, total_pages: 0, data: [] };
  }
  if (!res.ok) {
    throw new Error(`Scryfall search failed (${res.status})`);
  }

  const list = await res.json();
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

export async function postCardCollection(identifiers: Array<Record<string, string>>) {
  const res = await scryfallFetch('/cards/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers }),
  });
  if (!res.ok) throw new Error(`Scryfall collection failed (${res.status})`);
  return res.json();
}
