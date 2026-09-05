import { expect, test } from 'vitest';
import {
  buildCommanderBracketPayload,
  buildCommanderBracketShareUrl,
  formatCommanderBracketDeckListLine,
  getBracketEstimateFromResult,
  getBracketTagLabel,
} from './commanderBracket';
import type { DetailedCardEntry } from './constants';

test('formatCommanderBracketDeckListLine omits printing details', () => {
  expect(
    formatCommanderBracketDeckListLine({
      qty: 1,
      name: 'Sol Ring',
      set: 'cmm',
      collector_number: '472',
    } as DetailedCardEntry),
  ).toBe('1 Sol Ring');
});

test('buildCommanderBracketPayload uses plain names for the API', () => {
  const payload = buildCommanderBracketPayload([
    {
      qty: 1,
      name: 'Kilo, Apogee Mind',
      categories: ['commander'],
      set: 'eoc',
      collector_number: '3',
    } as DetailedCardEntry,
    {
      qty: 1,
      name: 'Sol Ring',
      categories: [],
      set: 'cmm',
      collector_number: '472',
    } as DetailedCardEntry,
  ]);

  expect(payload.commanders).toEqual(['Kilo, Apogee Mind']);
  expect(payload.decklist).toBe('// Commander\n1 Kilo, Apogee Mind\n\n1 Sol Ring');
  expect(payload.decklist).not.toContain('[cmm]');
});

test('buildCommanderBracketShareUrl encodes deck for CommanderBracket', () => {
  const payload = buildCommanderBracketPayload([
    {
      qty: 1,
      name: 'Kilo, Apogee Mind',
      categories: ['commander'],
    } as never,
    { qty: 1, name: 'Sol Ring', categories: [] } as never,
  ]);

  const url = buildCommanderBracketShareUrl(payload);
  expect(url.startsWith('https://commanderbracket.app/bracket?')).toBe(true);
  expect(url).toContain('deck=');
  expect(url).toContain('src=partner_deep_link');
});

test('getBracketEstimateFromResult requires a clean estimate', () => {
  expect(
    getBracketEstimateFromResult({
      validation: { errors: [{ message: 'Too few cards' }] },
      bracket_analysis: { final_bracket: 2 },
    }),
  ).toBeUndefined();

  expect(
    getBracketEstimateFromResult({
      validation: { valid: true, warnings: [{ message: 'Note' }] },
      bracket_analysis: { final_bracket: 3, deck_bracket: 2 },
    }),
  ).toBe(3);
});

test('getBracketTagLabel uses cEDH for bracket 5', () => {
  expect(getBracketTagLabel(5)).toBe('cEDH');
  expect(getBracketTagLabel(2)).toBe('Bracket 2');
});
