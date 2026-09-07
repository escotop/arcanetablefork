import { expect, test } from 'vitest';
import { Deck, DetailedCardEntry } from './constants';
import { computeDeckContentHash } from './deckHydratedCache';
import { slimCardDetail } from './scryfallCache';

test('computeDeckContentHash ignores card detail', () => {
  const baseCard: DetailedCardEntry = {
    id: 'abc',
    name: 'Lightning Bolt',
    qty: 1,
    categories: [],
    set: 'lea',
    detail: { name: 'Lightning Bolt', image_uris: {}, type_line: '', popularity: 1, search: '' },
  };

  const deckA: Deck = {
    id: 'deck-1',
    name: 'Test',
    cards: { bolt: baseCard },
    inPlay: {},
  };

  const deckB: Deck = {
    ...deckA,
    cards: {
      bolt: {
        ...baseCard,
        detail: {
          ...baseCard.detail,
          oracle_text: 'Deal 3 damage to any target.',
        },
      },
    },
  };

  expect(computeDeckContentHash(deckA)).toBe(computeDeckContentHash(deckB));
});

test('computeDeckContentHash changes when qty changes', () => {
  const deck: Deck = {
    id: 'deck-1',
    name: 'Test',
    cards: {
      bolt: {
        id: 'abc',
        name: 'Lightning Bolt',
        qty: 1,
        categories: [],
        set: 'lea',
        detail: { name: 'Lightning Bolt', image_uris: {}, type_line: '', popularity: 1, search: '' },
      },
    },
    inPlay: {},
  };

  const changed: Deck = {
    ...deck,
    cards: {
      bolt: {
        ...deck.cards.bolt,
        qty: 2,
      },
    },
  };

  expect(computeDeckContentHash(deck)).not.toBe(computeDeckContentHash(changed));
});

test('slimCardDetail drops all_parts and keeps render fields', () => {
  const detail = slimCardDetail({
    name: 'Sol Ring',
    image_uris: { normal: 'https://example.com/sol.jpg' },
    type_line: 'Artifact',
    popularity: 1,
    search: 'Sol Ring',
    all_parts: [{ name: 'Treasure', component: 'token', uri: 'https://example.com/t' }],
    oracle_text: 'Tap: Add two mana.',
  });

  expect(detail.all_parts).toBeUndefined();
  expect(detail.image_uris.normal).toBe('https://example.com/sol.jpg');
  expect(detail.oracle_text).toBe('Tap: Add two mana.');
});
