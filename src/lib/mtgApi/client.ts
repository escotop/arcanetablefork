import type { CardEntryDetail } from '../constants';
import type { ScryfallSearchResult } from '../scryfall/client';

const MTG_API_BASE = 'https://api.magicthegathering.io/v1';
const PAGE_SIZE = 100;

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
  return unique;
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
  params.set('orderBy', 'name');

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

/**
 * Deck-editor catalog search via [MTG API](https://docs.magicthegathering.io/).
 * Does not use the Scryfall queue (separate 5000 req/h limit).
 */
export async function searchMtgApiCards(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
): Promise<ScryfallSearchResult> {
  const page = options.page ?? 1;
  const params = buildMtgApiSearchParams(q, options);
  const url = `${MTG_API_BASE}/cards?${params}`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 403) {
    throw new Error('MTG API rate limit exceeded');
  }
  if (!response.ok) {
    throw new Error(`MTG API search failed (${response.status})`);
  }

  const body = (await response.json()) as MtgApiCardsResponse;
  const mapped = dedupeByCardName((body.cards ?? []).map(mapMtgApiCardToDetail));

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
