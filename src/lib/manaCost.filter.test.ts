import { describe, expect, it } from 'vitest';
import type { CardEntryDetail } from './constants';
import { entryMatchesManaFilter } from './manaCost';

const card = (detail: Partial<CardEntryDetail> & { produced_mana?: string[] }) => ({
  qty: 1,
  detail: { name: 'x', type_line: 'Creature', ...detail } as CardEntryDetail,
});

const azorius = card({ mana_cost: '{1}{W}{U}' });
const mono = card({ mana_cost: '{2}{W}' });
const artifact = card({ mana_cost: '{3}', type_line: 'Artifact' });

describe('entryMatchesManaFilter', () => {
  it('OR matches cards with any selected color', () => {
    expect(entryMatchesManaFilter(mono, ['W', 'U'], 'or')).toBe(true);
    expect(entryMatchesManaFilter(azorius, ['U', 'R'], 'or')).toBe(true);
    expect(entryMatchesManaFilter(mono, ['R'], 'or')).toBe(false);
  });

  it('AND needs every selected color', () => {
    expect(entryMatchesManaFilter(azorius, ['W', 'U'], 'and')).toBe(true);
    expect(entryMatchesManaFilter(mono, ['W', 'U'], 'and')).toBe(false);
  });

  it('excluded colors remove cards that contain them', () => {
    const red = card({ mana_cost: '{R}' });
    const rakdos = card({ mana_cost: '{B}{R}' });
    expect(entryMatchesManaFilter(rakdos, ['R'], 'or')).toBe(true);
    expect(entryMatchesManaFilter(rakdos, ['R'], 'or', ['B'])).toBe(false);
    expect(entryMatchesManaFilter(red, ['R'], 'or', ['B'])).toBe(true);
    expect(entryMatchesManaFilter(mono, [], 'or', ['B'])).toBe(true);
    expect(entryMatchesManaFilter(rakdos, [], 'or', ['B'])).toBe(false);
  });

  it('C means colorless for spells', () => {
    expect(entryMatchesManaFilter(artifact, ['C'], 'or')).toBe(true);
    expect(entryMatchesManaFilter(mono, ['C'], 'or')).toBe(false);
  });

  it('lands use the mana they produce, not their cost', () => {
    const hallowed = card({ type_line: 'Land — Plains Island', oracle_text: '' });
    const city = card({ type_line: 'Land', oracle_text: '{T}: Add one mana of any color.' });
    const wastes = card({ type_line: 'Basic Land', oracle_text: '{T}: Add {C}.' });
    const produced = card({ type_line: 'Land', produced_mana: ['B', 'G'] });

    expect(entryMatchesManaFilter(hallowed, ['W', 'U'], 'and')).toBe(true);
    expect(entryMatchesManaFilter(hallowed, ['R'], 'or')).toBe(false);
    expect(entryMatchesManaFilter(city, ['R', 'G'], 'and')).toBe(true);
    expect(entryMatchesManaFilter(wastes, ['C'], 'or')).toBe(true);
    expect(entryMatchesManaFilter(produced, ['B', 'G'], 'and')).toBe(true);
    expect(entryMatchesManaFilter(produced, ['W'], 'or')).toBe(false);
  });
});
