import { expect, test } from 'vitest';
import { formatDeckListLine } from './deckListFormat';

test('formatDeckListLine includes set and collector number', () => {
  expect(
    formatDeckListLine({
      id: 'abc',
      name: 'Orcish Bowmasters',
      qty: 1,
      set: 'ltr',
      collector_number: '433',
      categories: [],
    }),
  ).toBe('1 Orcish Bowmasters [ltr] #433');
});

test('formatDeckListLine omits collector when missing', () => {
  expect(
    formatDeckListLine({
      id: 'abc',
      name: 'Lightning Bolt',
      qty: 4,
      set: 'lea',
      categories: [],
    }),
  ).toBe('4 Lightning Bolt [lea]');
});

test('formatDeckListLine includes custom art suffix', () => {
  const url = 'https://example.com/my-art.png';
  expect(
    formatDeckListLine({
      id: 'abc',
      name: 'Sol Ring',
      qty: 1,
      set: 'c21',
      collector_number: '263',
      categories: [],
      customArtUrl: url,
    }),
  ).toBe(`1 Sol Ring [c21] #263 {art:${encodeURIComponent(url)}}`);
});
