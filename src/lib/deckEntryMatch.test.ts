import { expect, test } from 'vitest';
import { DetailedCardEntry } from './constants';
import {
  findDeckEntryMatch,
  getCardKey,
  remainingDeckQtyAfterInPlay,
} from './deckEntryMatch';

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

test('getCardKey distinguishes printings with the same name and set', () => {
  const nazgul336 = { name: 'Nazgûl', set: 'ltr', collector_number: '336', qty: 1 };
  const nazgul339 = { name: 'Nazgûl', set: 'ltr', collector_number: '339', qty: 1 };

  expect(getCardKey(nazgul336)).toBe('Nazgûl:ltr:336');
  expect(getCardKey(nazgul339)).toBe('Nazgûl:ltr:339');
  expect(getCardKey(nazgul336)).not.toBe(getCardKey(nazgul339));
});

test('getCardKey keeps set-only keys when collector number is missing', () => {
  expect(getCardKey({ name: 'Island', set: 'ltr', qty: 1 })).toBe('Island:ltr');
});

test('remainingDeckQtyAfterInPlay removes commander when inPlay uses a different storage key', () => {
  const defaultPrintingId = '00000000-0000-0000-0000-000000000001';
  const chosenPrintingId = '00000000-0000-0000-0000-000000000002';

  const deckCommander: DetailedCardEntry = {
    id: defaultPrintingId,
    name: 'Korvold, Fae-Cursed King',
    qty: 1,
    set: 'eld',
    collector_number: '329',
    categories: ['commander'],
    detail: {
      id: defaultPrintingId,
      name: 'Korvold, Fae-Cursed King',
      oracle_id: 'oracle-korvold',
      image_uris: { normal: 'https://example.com/default.jpg' },
      search: '',
      popularity: 1,
    },
  };

  const inPlayCommander: DetailedCardEntry = {
    id: chosenPrintingId,
    name: 'Korvold, Fae-Cursed King',
    qty: 1,
    set: 'sld',
    collector_number: '1234',
    categories: ['commander'],
    detail: {
      id: chosenPrintingId,
      name: 'Korvold, Fae-Cursed King',
      oracle_id: 'oracle-korvold',
      image_uris: { normal: 'https://example.com/chosen.jpg' },
      search: '',
      popularity: 1,
    },
  };

  const inPlay = { [getCardKey(inPlayCommander)]: inPlayCommander };
  expect(remainingDeckQtyAfterInPlay(deckCommander, inPlay)).toBe(0);
});
