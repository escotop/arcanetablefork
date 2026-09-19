import { expect, test } from 'vitest';
import { DEFAULT_DECK_PREVIEW, getDeckPreviewImageUrl } from './deckCoverPreview';
import { Deck, DetailedCardEntry } from './constants';
function deckWithCommander(entry: DetailedCardEntry): Deck {
  return {
    id: 'd1',
    version: 1,
    system: 'mtg',
    name: 'Test',
    startingLife: 40,
    cards: {},
    inPlay: { [entry.id || entry.name]: entry },
  };
}

test('getDeckPreviewImageUrl uses detail.id not composite deck entry id', () => {
  const scryfallId = '00000000-0000-0000-0000-000000000001';
  const deck = deckWithCommander({
    id: 'Sol Ring:mh1:242',
    name: 'Sol Ring',
    qty: 1,
    categories: [],
    set: 'mh1',
    collector_number: '242',
    detail: {
      id: scryfallId,
      name: 'Sol Ring',
      image_uris: {
        art_crop: 'https://cards.scryfall.io/art_crop/front/a/b/sol.jpg',
      },
    },
  });

  expect(getDeckPreviewImageUrl(deck)).toBe('https://cards.scryfall.io/art_crop/front/a/b/sol.jpg');
});

test('getDeckPreviewImageUrl ignores api.scryfall.com stored covers', () => {
  const deck = deckWithCommander({
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Commander',
    qty: 1,
    categories: ['commander'],
    set: 'c16',
    collector_number: '28',
    detail: {
      name: 'Commander',
      image_uris: {
        normal: 'https://cards.scryfall.io/normal/front/a/b/cmd.jpg',
      },
    },
  });
  deck.coverImage =
    'https://api.scryfall.com/cards/fa7349d9-c82f-4cf8-a852-92168d1f4966?format=image&version=art_crop';

  expect(getDeckPreviewImageUrl(deck)).toBe(
    'https://cards.scryfall.io/normal/front/a/b/cmd.jpg',
  );
});

test('getDeckPreviewImageUrl uses default back when only printing ids are stored', () => {
  const deck = deckWithCommander({
    id: 'Atraxa, Praetors\' Voice:c16:28',
    name: '',
    qty: 1,
    categories: ['commander'],
    set: '',
  });

  expect(getDeckPreviewImageUrl(deck)).toContain('card%20back.png');
});
test('getDeckPreviewImageUrl prefers stored coverImage', () => {
  const deck = deckWithCommander({
    id: 'Sol Ring:mh1:242',
    name: 'Sol Ring',
    qty: 1,
    categories: [],
    set: 'mh1',
    collector_number: '242',
    detail: {
      name: 'Sol Ring',
      image_uris: {
        art_crop: 'https://cards.scryfall.io/art_crop/front/a/b/other.jpg',
      },
    },
  });
  deck.coverImage = 'https://cards.scryfall.io/normal/front/x/y/stored.jpg';

  expect(getDeckPreviewImageUrl(deck)).toBe(
    'https://cards.scryfall.io/normal/front/x/y/stored.jpg',
  );
});

test('getDeckPreviewImageUrl prefers custom art', () => {
  const deck = deckWithCommander({
    id: 'x',
    name: 'Test',
    qty: 1,
    categories: [],
    customArtUrl: 'https://example.com/art.jpg',
    detail: { name: 'Test' },
  });

  expect(getDeckPreviewImageUrl(deck)).toBe('https://example.com/art.jpg');
});
