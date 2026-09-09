import { expect, test } from 'vitest';
import {
  buildCommanderBracketPayload,
  buildCommanderBracketShareUrl,
  compareDecksByBracket,
  formatCommanderBracketDeckListLine,
  getBracketEstimateFromResult,
  getBracketTagLabel,
  getHowItPlaysSection,
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

test('getHowItPlaysSection builds opening hand advice from deck_stats', () => {
  expect(
    getHowItPlaysSection({
      deck_stats: {
        report: {
          consistency: { p_keepable_opener: 0.88 },
          advice: {
            mulligan: {
              land_range: { min: 2, max: 4 },
              p_keepable: 0.88,
              commander_castable_by: 6,
            },
            hold_priority: [
              {
                name: 'Swords to Plowshares',
                reason_code: 'instant_interaction',
                timing_code: 'open_mana',
              },
              {
                name: 'Boros Charm',
                reason_code: 'instant_interaction',
                timing_code: 'before_committing_board',
              },
            ],
          },
        },
      },
    }),
  ).toEqual({
    summary: '88% keepable openers, 2 cards worth holding',
    bullets: ['Keep 2-4 lands', 'Commander online by turn 6'],
    landRange: { min: 2, max: 4 },
    openerDetail:
      '88% of openers are keepable (2-4 lands and a castable early play, across your first two draws)',
    worthHolding: [
      {
        name: 'Swords to Plowshares',
        reasonLabel: 'Instant speed',
        timingLabel: 'generally worth leaving mana open for',
      },
      {
        name: 'Boros Charm',
        reasonLabel: 'Instant speed',
        timingLabel: 'generally worth holding before committing your board to a big turn',
      },
    ],
  });

  expect(getHowItPlaysSection(undefined)).toBeUndefined();
});

test('getBracketTagLabel uses cEDH for bracket 5', () => {
  expect(getBracketTagLabel(5)).toBe('cEDH');
  expect(getBracketTagLabel(2)).toBe('Bracket 2');
});

test('compareDecksByBracket sorts by bracket then name', () => {
  const decks = [
    { name: 'Zebra', bracketEstimate: 2 },
    { name: 'Alpha', bracketEstimate: 3 },
    { name: 'No bracket' },
    { name: 'Beta', bracketEstimate: 3 },
    { name: 'Exalted', bracketEstimate: 5 },
    { name: 'Casual', bracketEstimate: 1 },
  ].sort(compareDecksByBracket);

  expect(decks.map(deck => deck.name)).toEqual([
    'Casual',
    'Zebra',
    'Alpha',
    'Beta',
    'Exalted',
    'No bracket',
  ]);
});
