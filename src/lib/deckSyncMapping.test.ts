import { describe, expect, it } from 'vitest';
import type { Deck } from './constants';
import { deckToRemote, hashString, remoteToDeck, stableStringify } from './deckSyncMapping';

const deckHash = (deck: Deck) => hashString(stableStringify(deck));

function toRow(deck: Deck) {
  const { deck: d, cards } = deckToRemote(deck);
  return {
    ...d,
    deck_cards: cards.map((card, position) => ({ ...card, position })),
  } as any;
}

describe('deck sync mapping', () => {
  it('round-trips a deck through the remote row shape', () => {
    const deck = {
      id: 'abc123',
      version: 2,
      system: 'mtg',
      name: 'Atraxa',
      startingLife: 40,
      bracketEstimate: 3,
      tags: [{ name: 'combo' }],
      coverImage: 'https://example.com/a.jpg',
      counters: [{ id: 'c1', name: 'Poison', color: '#0f0' }],
      somethingNew: { keep: true },
      cards: {
        'sol-ring': {
          id: 'scry-1', name: 'Sol Ring', qty: 1, set: 'c21', collector_number: '263',
          categories: ['Ramp'], customArtUrl: 'https://example.com/art.png',
        },
      },
      inPlay: { atraxa: { id: 'scry-2', name: 'Atraxa', qty: 1, set: 'one', categories: ['Commander'] } },
      sideboard: {},
      tokens: { t: { id: 'scry-3', name: 'Treasure', qty: 1, set: 'tc21', categories: [], manualToken: true } },
    } as unknown as Deck;

    const back = remoteToDeck(toRow(deck));
    expect(back).toMatchObject({
      id: 'abc123', name: 'Atraxa', bracketEstimate: 3, tags: [{ name: 'combo' }],
      somethingNew: { keep: true },
    });
    expect(back.cards['sol-ring']).toEqual(deck.cards['sol-ring']);
    expect(back.inPlay.atraxa).toEqual(deck.inPlay.atraxa);
    expect(back.tokens!.t).toEqual(deck.tokens!.t);
    expect(deckHash(remoteToDeck(toRow(back)))).toBe(deckHash(back));
  });

  it('hash ignores key order', () => {
    const a = { id: 'x', name: 'A', version: 2, system: 'mtg', startingLife: 40, cards: {}, inPlay: {} } as unknown as Deck;
    const b = { inPlay: {}, cards: {}, startingLife: 40, system: 'mtg', version: 2, name: 'A', id: 'x' } as unknown as Deck;
    expect(deckHash(a)).toBe(deckHash(b));
  });
});
