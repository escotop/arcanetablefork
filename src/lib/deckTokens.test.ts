import { expect, test } from 'vitest';
import {
  collectParentCardIdsForTokenLookup,
  collectTokenPartIds,
  tokenPartId,
} from './deckTokens';

test('tokenPartId reads id from Scryfall card uri', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  expect(
    tokenPartId({
      name: 'Treasure',
      component: 'token',
      uri: `https://api.scryfall.com/cards/${id}`,
    }),
  ).toBe(id);
});

test('collectTokenPartIds includes tokens referenced only by uri', () => {
  const tokenId = '11111111-2222-3333-4444-555555555555';
  const ids = collectTokenPartIds([
    {
      detail: {
        all_parts: [
          {
            name: 'Treasure',
            component: 'token',
            uri: `https://api.scryfall.com/cards/${tokenId}`,
          },
        ],
      },
    },
  ]);
  expect(ids).toEqual([tokenId]);
});

test('collectParentCardIdsForTokenLookup skips cards that already list tokens', () => {
  const parentId = 'parent-id';
  const ids = collectParentCardIdsForTokenLookup([
    {
      detail: {
        id: parentId,
        all_parts: [{ name: 'Goblin', component: 'token', id: 'token-id', uri: 'x' }],
      },
    },
    { detail: { id: 'needs-fetch', name: 'Parent' } },
  ]);
  expect(ids).toEqual(['needs-fetch']);
});
