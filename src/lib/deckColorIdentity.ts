import type { CardEntryDetail, Deck, DetailedCardEntry } from './constants';
import { isCommanderCard } from './deckCommander';

export type IdentityColor = 'W' | 'U' | 'B' | 'R' | 'G';

export const IDENTITY_ORDER: IdentityColor[] = ['W', 'U', 'B', 'R', 'G'];

/**
 * Bump when the way identity is computed changes, so stored values get recomputed.
 * v2: partner commanders from inPlay too, and color indicators (e.g. Rograkh).
 */
export const COLOR_IDENTITY_VERSION = 2;

type DetailWithColors = CardEntryDetail & {
  color_identity?: string[];
  color_indicator?: string[];
  colors?: string[];
};

type DeckIdentitySource = Pick<Deck, 'cards' | 'inPlay'>;

function sortIdentity(colors: Iterable<string>): IdentityColor[] {
  const set = new Set(colors);
  return IDENTITY_ORDER.filter(color => set.has(color));
}

export function hasKnownColorIdentity(detail: CardEntryDetail | null | undefined) {
  return Array.isArray((detail as DetailWithColors | undefined)?.color_identity);
}

/**
 * Scryfall's color_identity when present. Otherwise: color indicators, colors, and the
 * colored symbols in cost and rules text of every face.
 */
export function cardColorIdentity(detail: CardEntryDetail): IdentityColor[] {
  const known = (detail as DetailWithColors).color_identity;
  if (Array.isArray(known)) return sortIdentity(known);

  const colors = new Set<string>();
  const faces = [detail, ...(detail.card_faces ?? [])] as DetailWithColors[];
  for (const face of faces) {
    for (const color of face.color_indicator ?? []) colors.add(color);
    for (const color of face.colors ?? []) colors.add(color);
    const text = `${face.mana_cost ?? ''} ${face.oracle_text ?? ''}`;
    for (const match of text.matchAll(/\{([^}]+)\}/g)) {
      for (const part of match[1].split('/')) {
        if ((IDENTITY_ORDER as string[]).includes(part)) colors.add(part);
      }
    }
  }
  return sortIdentity(colors);
}

/**
 * Cards that define the deck's identity: every commander (both partners, whether marked
 * in the main deck or only kept in play), or every main-deck card when there are none.
 */
export function identityCards(deck: DeckIdentitySource): DetailedCardEntry[] {
  const cards = Object.values(deck.cards ?? {}).filter(card => card && (card.qty ?? 1) > 0);
  const commanders = new Map<string, DetailedCardEntry>();
  for (const card of [...cards, ...Object.values(deck.inPlay ?? {})]) {
    if (!card || !isCommanderCard(card)) continue;
    const key = card.name?.trim().toLowerCase() || card.id;
    const existing = commanders.get(key);
    // Prefer the copy that has card details loaded.
    if (!existing || (!existing.detail?.name && card.detail?.name)) commanders.set(key, card);
  }
  return commanders.size ? [...commanders.values()] : cards;
}

/**
 * Identity from the card details already loaded on the deck.
 * Undefined when some of the cards that matter lack Scryfall's color_identity (e.g. old
 * cached details), so a guessed value never overwrites a good one.
 */
export function computeDeckColorIdentity(deck: DeckIdentitySource): IdentityColor[] | undefined {
  const cards = identityCards(deck);
  if (cards.some(card => !hasKnownColorIdentity(card.detail))) return undefined;
  return sortIdentity(cards.flatMap(card => cardColorIdentity(card.detail)));
}

/** Identity for a stored deck (no details), looking cards up in the local caches. */
export async function resolveDeckColorIdentity(
  deck: DeckIdentitySource,
): Promise<IdentityColor[] | undefined> {
  const [{ getCachedCardDetail }, { lookupBulkCard }] = await Promise.all([
    import('./scryfallCache'),
    import('./scryfallBulkIndex'),
  ]);

  const colors: IdentityColor[] = [];
  let found = 0;
  const cards = identityCards(deck);
  for (const card of cards) {
    let detail: CardEntryDetail | null = card.detail?.name ? card.detail : null;
    if (!hasKnownColorIdentity(detail)) {
      detail = (await getCachedCardDetail(card).catch(() => null)) ?? detail;
    }
    if (!hasKnownColorIdentity(detail)) {
      // The bulk index keeps Scryfall's color_identity.
      detail = (await lookupBulkCard(card.name).catch(() => null)) ?? detail;
    }
    if (!detail) continue;
    found++;
    colors.push(...cardColorIdentity(detail));
  }
  // Nothing found at all: don't store a wrong "colorless" value.
  if (cards.length && !found) return undefined;
  return sortIdentity(colors);
}
