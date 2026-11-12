import { describe, expect, it } from 'vitest';
import type { CardEntryDetail, DetailedCardEntry } from './constants';
import { cardColorIdentity, computeDeckColorIdentity, identityCards } from './deckColorIdentity';

const entry = (name: string, detail: Record<string, unknown>, commander = false) =>
  ({
    id: name,
    name,
    qty: 1,
    set: '',
    categories: commander ? ['commander'] : [],
    detail: { name, type_line: 'Legendary Creature', ...detail } as unknown as CardEntryDetail,
  }) as DetailedCardEntry;

describe('deck color identity', () => {
  it('uses the color indicator of cards without a mana cost', () => {
    expect(cardColorIdentity({ name: 'Rograkh', color_indicator: ['R'] } as never)).toEqual(['R']);
  });

  it('combines both partner commanders', () => {
    const rograkh = entry('Rograkh, Son of Rohgahh', { color_identity: ['R'] }, true);
    const partner = entry('Ardenn, Intrepid Archaeologist', { color_identity: ['W'] }, true);
    const other = entry('Island', { color_identity: [] });
    const deck = { cards: { a: rograkh, b: partner, c: other }, inPlay: {} };
    expect(computeDeckColorIdentity(deck)).toEqual(['W', 'R']);
  });

  it('includes commanders kept only in play', () => {
    const inPlayOnly = entry('Rograkh, Son of Rohgahh', { color_identity: ['R'] }, true);
    const marked = entry('Thrasios, Triton Hero', { color_identity: ['G', 'U'] }, true);
    const deck = { cards: { a: marked }, inPlay: { r: inPlayOnly } };
    expect(identityCards(deck)).toHaveLength(2);
    expect(computeDeckColorIdentity(deck)).toEqual(['U', 'R', 'G']);
  });

  it('does not guess when details lack color_identity', () => {
    const old = entry('Rograkh, Son of Rohgahh', { mana_cost: '' }, true);
    expect(computeDeckColorIdentity({ cards: { a: old }, inPlay: {} })).toBeUndefined();
  });
});
