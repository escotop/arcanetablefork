import { expect, test } from 'vitest';
import {
  collectParentCardIdsForTokenLookup,
  collectTokenPartIds,
  getDefaultTokenEntry,
  getTokenKey,
  mergeTokenPrintings,
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

test('getTokenKey tolerates missing detail', () => {
  expect(getTokenKey(undefined)).toBe('');
  expect(getTokenKey({ name: 'Treasure', id: 'abc' } as never)).toBe('abc');
});

test('getDefaultTokenEntry ignores undefined defaults entries', () => {
  const entry = getDefaultTokenEntry('abc', [
    undefined as never,
    { id: 'abc', name: 'Treasure' } as never,
  ]);
  expect(entry?.name).toBe('Treasure');
});

test('mergeTokenPrintings skips invalid token rows', () => {
  const merged = mergeTokenPrintings([undefined as never, { id: 't1', name: 'Token' } as never], {});
  expect(merged).toHaveLength(1);
  expect(merged[0]?.name).toBe('Token');
});
