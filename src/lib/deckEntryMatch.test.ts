import { expect, test } from 'vitest';
import { getCardKey } from './deckEntryMatch';

test('getCardKey distinguishes custom art on the same printing', () => {
  const base = {
    id: '',
    name: 'Sol Ring',
    qty: 1,
    categories: [] as string[],
    set: 'c21',
    collector_number: '263',
  };

  const withoutArt = getCardKey(base);
  const withArt = getCardKey({
    ...base,
    customArtUrl: 'https://example.com/art.png',
  });

  expect(withoutArt).toBe('Sol Ring:c21:263');
  expect(withArt).not.toBe(withoutArt);
  expect(withArt).toContain('::art:');
});
