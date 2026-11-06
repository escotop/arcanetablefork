import type { Deck, DetailedCardEntry } from './constants';
import { MTG_CARD_SYSTEM } from './mtgCardSystem';

/** Converts decks between the app's shape and the Supabase `decks` / `deck_cards` rows. */

type SectionKey = 'cards' | 'inPlay' | 'sideboard' | 'tokens';
const SECTIONS: [SectionKey, string][] = [
  ['cards', 'main'],
  ['inPlay', 'in_play'],
  ['sideboard', 'sideboard'],
  ['tokens', 'tokens'],
];
const SECTION_BY_REMOTE = Object.fromEntries(SECTIONS.map(([local, remote]) => [remote, local]));

const DECK_FIELDS = new Set([
  'id', 'version', 'system', 'cards', 'inPlay', 'sideboard', 'tokens', 'tags', 'bracketEstimate',
  'howItPlaysAdvice', 'startingLife', 'name', 'cardList', 'coverImage', 'coverImageFullArt',
  'counters',
]);
const CARD_FIELDS = new Set([
  'id', 'name', 'qty', 'set', 'collector_number', 'customArtUrl', 'categories', 'manualToken',
]);

type RemoteCardRow = {
  section: string;
  card_key: string;
  position: number;
  card_id: string;
  name: string;
  qty: number;
  set: string;
  collector_number: string | null;
  custom_art_url: string | null;
  categories: string[] | null;
  manual_token: boolean;
  extra: Record<string, unknown> | null;
};

export type RemoteDeckRow = {
  id: string;
  name: string;
  system: string;
  version: number;
  starting_life: number;
  bracket_estimate: number | null;
  tags: string[] | null;
  cover_image: string | null;
  cover_image_full_art: boolean | null;
  card_list: string | null;
  counters: Deck['counters'] | null;
  how_it_plays_advice: Deck['howItPlaysAdvice'] | null;
  extra: Record<string, unknown> | null;
  deck_cards: RemoteCardRow[];
};

function pickExtra(source: object, known: Set<string>) {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key) && value !== undefined) extra[key] = value;
  }
  return extra;
}

export function deckToRemote(deck: Deck) {
  const cards: Record<string, unknown>[] = [];
  for (const [localSection, remoteSection] of SECTIONS) {
    for (const [cardKey, card] of Object.entries(deck[localSection] ?? {})) {
      cards.push({
        section: remoteSection,
        card_key: cardKey,
        card_id: card.id ?? '',
        name: card.name ?? '',
        qty: card.qty ?? 1,
        set: card.set ?? '',
        collector_number: card.collector_number ?? null,
        custom_art_url: card.customArtUrl ?? null,
        categories: card.categories ?? [],
        manual_token: !!card.manualToken,
        extra: pickExtra(card, CARD_FIELDS),
      });
    }
  }

  return {
    deck: {
      id: deck.id,
      name: deck.name ?? '',
      system: deck.system ?? '',
      version: deck.version ?? 0,
      starting_life: deck.startingLife ?? 40,
      bracket_estimate: deck.bracketEstimate ?? null,
      tags: (deck.tags ?? []).map(tag => tag.name),
      cover_image: deck.coverImage ?? null,
      cover_image_full_art: deck.coverImageFullArt ?? null,
      card_list: deck.cardList ?? null,
      counters: deck.counters ?? null,
      how_it_plays_advice: deck.howItPlaysAdvice ?? null,
      extra: pickExtra(deck, DECK_FIELDS),
    },
    cards,
  };
}

export function remoteToDeck(row: RemoteDeckRow): Deck {
  const deck: Deck = {
    ...(row.extra ?? {}),
    id: row.id,
    name: row.name,
    system: row.system || MTG_CARD_SYSTEM.id,
    version: row.version,
    startingLife: row.starting_life,
    cards: {},
    inPlay: {},
    sideboard: {},
    tokens: {},
  } as Deck;

  if (row.tags?.length) deck.tags = row.tags.map(name => ({ name }));
  if (row.bracket_estimate != null) deck.bracketEstimate = Number(row.bracket_estimate);
  if (row.cover_image != null) deck.coverImage = row.cover_image;
  if (row.cover_image_full_art != null) deck.coverImageFullArt = row.cover_image_full_art;
  if (row.card_list != null) deck.cardList = row.card_list;
  if (row.counters != null) deck.counters = row.counters;
  if (row.how_it_plays_advice != null) deck.howItPlaysAdvice = row.how_it_plays_advice;

  const rows = [...(row.deck_cards ?? [])].sort((a, b) => a.position - b.position);
  for (const card of rows) {
    const section = SECTION_BY_REMOTE[card.section] as SectionKey | undefined;
    if (!section) continue;
    const entry = {
      ...(card.extra ?? {}),
      id: card.card_id,
      name: card.name,
      qty: card.qty,
      set: card.set,
      categories: card.categories ?? [],
    } as DetailedCardEntry;
    if (card.collector_number != null) entry.collector_number = card.collector_number;
    if (card.custom_art_url != null) entry.customArtUrl = card.custom_art_url;
    if (card.manual_token) entry.manualToken = true;
    deck[section]![card.card_key] = entry;
  }
  return deck;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** cyrb53: small, fast, good enough to detect changes. */
export function hashString(str: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

