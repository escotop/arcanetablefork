import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { mergeImportedDecks, parseDecksZip } from './deckBulkTransfer';
import { Deck } from './constants';

describe('deckBulkTransfer', () => {
  it('imports decks from a zip of json files', () => {
    const deck: Deck = {
      id: 'deck-1',
      name: 'Test Deck',
      version: 2,
      system: 'scry-server-mtg',
      startingLife: 40,
      cards: {
        'lightning-bolt': {
          id: 'abc',
          name: 'Lightning Bolt',
          qty: 4,
          categories: [],
          set: 'lea',
          detail: undefined as never,
        },
      },
      inPlay: {},
    };

    const zip = zipSync({
      'test-deck.json': strToU8(JSON.stringify(deck)),
    });

    const imported = parseDecksZip(zip.buffer);
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe('Test Deck');

    const merged = mergeImportedDecks(imported, { decks: {}, systems: {} });
    expect(merged.decks['deck-1']).toBeDefined();
    expect(merged.systems['scry-server-mtg']).toContain('deck-1');
  });
});
