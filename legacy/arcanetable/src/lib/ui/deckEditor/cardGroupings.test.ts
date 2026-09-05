import { expect, test } from 'vitest';
import { getCardTypeCategory, getSimpleType } from './cardGroupings';

const types = ['creature', 'planeswalker', 'land', 'instant', 'sorcery', 'enchantment', 'artifact'];

test('getSimpleType uses type_line in game cards', () => {
  expect(getSimpleType({ detail: { type_line: 'Legendary Creature — Human Wizard' } })).toBe(
    'legendary creature',
  );
  expect(getSimpleType({ detail: { type_line: 'Basic Land — Swamp' } })).toBe('basic land');
  expect(getSimpleType({ detail: { type: 'Artifact — Equipment' } })).toBe('artifact');
});

test('getCardTypeCategory classifies game card types', () => {
  expect(
    getCardTypeCategory({ detail: { type_line: 'Instant' } }, types),
  ).toBe('instant');
  expect(
    getCardTypeCategory({ detail: { type_line: 'Artifact Creature — Construct' } }, types),
  ).toBe('creature');
  expect(
    getCardTypeCategory({ detail: { type_line: 'Basic Land — Forest' } }, types),
  ).toBe('land');
});
