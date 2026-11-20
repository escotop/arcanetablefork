import { compareDecksByBracket } from './commanderBracket';
import type { Deck } from './constants';

type ListedDeck = Pick<Deck, 'lastUsedAt' | 'bracketEstimate' | 'name'>;

/** Most recently edited or played decks first; never-used decks after, by bracket then name. */
export function compareDecksForList(left: ListedDeck, right: ListedDeck) {
  const diff = (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0);
  return diff !== 0 ? diff : compareDecksByBracket(left, right);
}
