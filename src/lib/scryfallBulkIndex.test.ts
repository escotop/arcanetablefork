import { expect, test } from 'vitest';
import { normalizeBulkName, slimBulkCard } from './scryfallBulkIndex';

test('names match regardless of case, accents and spacing', () => {
  expect(normalizeBulkName("Lim-Dûl's  Vault ")).toBe(normalizeBulkName("lim-dul's vault"));
});

test('slim records keep what the deck editor needs and drop the rest', () => {
  const slim = slimBulkCard({
    object: 'card',
    id: 'id-1',
    name: 'Delver of Secrets // Insectile Aberration',
    type_line: 'Creature — Human Wizard // Creature — Human Insect',
    prices: { usd: '1.00' },
    purchase_uris: { tcgplayer: 'x' },
    card_faces: [
      {
        name: 'Delver of Secrets',
        type_line: 'Creature — Human Wizard',
        image_uris: { normal: 'https://cards.scryfall.io/normal/front/a.jpg', png: 'p', huge: 'no' },
        flavor_text: 'dropped',
      },
    ],
    all_parts: [{ id: 't1', name: 'Clue', component: 'token', type_line: 'Token', uri: 'u', extra: 1 }],
  });

  expect(slim).not.toHaveProperty('prices');
  expect(slim).not.toHaveProperty('purchase_uris');
  expect(slim.card_faces).toEqual([
    {
      name: 'Delver of Secrets',
      type_line: 'Creature — Human Wizard',
      image_uris: { normal: 'https://cards.scryfall.io/normal/front/a.jpg', png: 'p' },
    },
  ]);
  expect(slim.all_parts).toEqual([
    { id: 't1', name: 'Clue', component: 'token', type_line: 'Token', uri: 'u' },
  ]);
});
