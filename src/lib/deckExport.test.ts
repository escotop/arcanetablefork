import { expect, test } from 'vitest';
import { formatDeckExportContent } from './deckListFormat';

test('formatDeckExportContent includes sideboard section', () => {
  expect(
    formatDeckExportContent({
      cards: {
        bolt: {
          id: 'bolt',
          name: 'Lightning Bolt',
          qty: 4,
          set: 'lea',
          categories: [],
          detail: { name: 'Lightning Bolt', search: '', type_line: '', popularity: 0, image_uris: {} },
        },
      },
      sideboard: {
        negate: {
          id: 'negate',
          name: 'Negate',
          qty: 2,
          set: 'm21',
          categories: [],
          detail: { name: 'Negate', search: '', type_line: '', popularity: 0, image_uris: {} },
        },
      },
    }),
  ).toBe('4 Lightning Bolt [lea]\n\nSIDEBOARD:\n2 Negate [m21]');
});
