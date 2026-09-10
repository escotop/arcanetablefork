import { expect, test } from 'vitest';
import {
  entryHasLegendary,
  entryMatchesSubtypeFilter,
  getCardSubtypeHaystack,
  getOfficialSubtypeList,
  getSpecialDeckType,
  getSubtypeOptionsForPeek,
  getSubtypeOptionsForTab,
  subtypeMatchesHaystack,
  tabSupportsSubtypeFilter,
} from './cardSubtypes';

test('getSpecialDeckType detects plane but not planeswalker', () => {
  expect(getSpecialDeckType({ detail: { type_line: 'Plane — Dominaria' } })).toBe('plane');
  expect(getSpecialDeckType({ detail: { type_line: 'Legendary Planeswalker — Jace' } })).toBeUndefined();
  expect(getSpecialDeckType({ detail: { type_line: 'Scheme — Some Scheme' } })).toBe('scheme');
  expect(getSpecialDeckType({ detail: { type_line: 'Battle — Siege' } })).toBe('battle');
});

test('entryMatchesSubtypeFilter uses AND logic', () => {
  const entry = { qty: 1, detail: { type_line: 'Legendary Creature — Human Wizard' } };

  expect(entryMatchesSubtypeFilter(entry, [])).toBe(true);
  expect(entryMatchesSubtypeFilter(entry, ['Human'])).toBe(true);
  expect(entryMatchesSubtypeFilter(entry, ['Wizard'])).toBe(true);
  expect(entryMatchesSubtypeFilter(entry, ['Human', 'Wizard'])).toBe(true);
  expect(entryMatchesSubtypeFilter(entry, ['Human', 'Elf'])).toBe(false);
});

test('entryMatchesSubtypeFilter supports Legendary supertype', () => {
  const legendary = { qty: 1, detail: { type_line: 'Legendary Artifact — Equipment' } };
  const nonLegendary = { qty: 1, detail: { type_line: 'Artifact — Equipment' } };

  expect(entryHasLegendary(legendary)).toBe(true);
  expect(entryHasLegendary(nonLegendary)).toBe(false);
  expect(entryMatchesSubtypeFilter(legendary, ['Legendary'])).toBe(true);
  expect(entryMatchesSubtypeFilter(nonLegendary, ['Legendary'])).toBe(false);
  expect(entryMatchesSubtypeFilter(legendary, ['Legendary', 'Equipment'])).toBe(true);
});

test('tabSupportsSubtypeFilter hides deck and shows all cards', () => {
  expect(tabSupportsSubtypeFilter('deck')).toBe(false);
  expect(tabSupportsSubtypeFilter('all')).toBe(true);
});

test('getSubtypeOptionsForPeek uses official list for type tabs', () => {
  expect(getSubtypeOptionsForPeek('creature', []).includes('Human')).toBe(true);
  expect(getSubtypeOptionsForPeek('creature', []).includes('Legendary')).toBe(true);
  expect(getSubtypeOptionsForPeek(null, [{ qty: 1, detail: { type_line: 'Instant' } }])).toEqual([
    'Legendary',
  ]);
});

test('getOfficialSubtypeList and tab options always include Legendary', () => {
  expect(getOfficialSubtypeList('instant')[0]).toBe('Legendary');
  expect(getOfficialSubtypeList('land').includes('Legendary')).toBe(true);
  expect(getSubtypeOptionsForTab('creature', 'all', [])[0]).toBe('Legendary');
});

test('subtypeMatchesHaystack supports multi-word subtypes', () => {
  const haystack = getCardSubtypeHaystack({
    detail: { type_line: 'Legendary Creature — Time Lord' },
  });

  expect(subtypeMatchesHaystack(haystack, 'Time Lord')).toBe(true);
});
