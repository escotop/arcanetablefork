import { expect, test } from 'vitest';
import { compareDecksForList } from './deckOrder';

test('recently used decks come first, the rest by bracket then name', () => {
  const decks = [
    { name: 'Old bracket 1', bracketEstimate: 1 },
    { name: 'Played yesterday', bracketEstimate: 4, lastUsedAt: 1_000 },
    { name: 'Edited today', bracketEstimate: 3, lastUsedAt: 2_000 },
    { name: 'No bracket' },
    { name: 'Old bracket 2', bracketEstimate: 2 },
  ].sort(compareDecksForList);

  expect(decks.map(deck => deck.name)).toEqual([
    'Edited today',
    'Played yesterday',
    'Old bracket 1',
    'Old bracket 2',
    'No bracket',
  ]);
});
