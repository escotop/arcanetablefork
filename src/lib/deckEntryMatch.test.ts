import { expect, test } from 'vitest';
import { DetailedCardEntry } from './constants';
import { findDeckEntryMatch } from './deckEntryMatch';

const deckBolt: DetailedCardEntry = {
  id: 'mh2-bolt-id',
  name: 'Lightning Bolt',
  qty: 4,
  set: 'mh2',
  categories: [],
  detail: {
    id: 'mh2-bolt-id',
    name: 'Lightning Bolt',
    oracle_id: 'oracle-bolt',
    type_line: 'Instant',
    image_uris: {},
    search: '',
    popularity: 1,
  },
};

test('findDeckEntryMatch matches another printing by oracle_id', () => {
  const catalogBolt: DetailedCardEntry = {
    id: 'lea-bolt-id',
    name: 'Lightning Bolt',
    qty: 1,
    set: 'lea',
    categories: [],
    detail: {
      id: 'lea-bolt-id',
      name: 'Lightning Bolt',
      oracle_id: 'oracle-bolt',
      type_line: 'Instant',
      image_uris: {},
      search: '',
      popularity: 1,
    },
  };

  const match = findDeckEntryMatch(catalogBolt, { [deckBolt.id]: deckBolt });
  expect(match?.key).toBe(deckBolt.id);
  expect(match?.entry.qty).toBe(4);
});

test('findDeckEntryMatch falls back to name when oracle_id is missing', () => {
  const catalogBolt: DetailedCardEntry = {
    id: 'lea-bolt-id',
    name: 'Lightning Bolt',
    qty: 1,
    set: 'lea',
    categories: [],
    detail: {
      id: 'lea-bolt-id',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      image_uris: {},
      search: '',
      popularity: 1,
    },
  };

  const deckEntry: DetailedCardEntry = {
    ...deckBolt,
    detail: { ...deckBolt.detail, oracle_id: undefined },
  };

  const match = findDeckEntryMatch(catalogBolt, { [deckEntry.id]: deckEntry });
  expect(match?.key).toBe(deckEntry.id);
});
