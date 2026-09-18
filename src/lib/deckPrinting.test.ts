import { expect, test } from 'vitest';
import { CardEntryDetail } from './constants';
import {
  buildDefaultPrintingsSearchQuery,
  normalizeDoubleFacedCardName,
  printingMatchesRequest,
  resolvePrintingsLookup,
  resolvePrintingsLookupName,
  scryfallCardMatchesPrintingsLookup,
} from './deckPrinting';

const entry = {
  name: 'Swiftfoot Boots',
  set: 'fdn',
  collector_number: '258',
  qty: 1,
} as const;

const payload = {
  id: 'test-id',
  name: 'Swiftfoot Boots',
  set: 'fdn',
  set_name: 'Foundations',
  collector_number: '258',
} as CardEntryDetail;

test('printingMatchesRequest accepts exact set and collector', () => {
  expect(printingMatchesRequest(payload, entry)).toBe(true);
});

test('printingMatchesRequest accepts when resolved collector is missing', () => {
  const minimal = { ...payload, collector_number: undefined };
  expect(printingMatchesRequest(minimal, entry)).toBe(true);
});

test('printingMatchesRequest accepts set name when set code differs', () => {
  const byName = { ...payload, set: 'fdn', set_name: 'Foundations' };
  expect(
    printingMatchesRequest(byName, {
      ...entry,
      set: 'foundations',
    }),
  ).toBe(true);
});

test('printingMatchesRequest rejects mismatched collector', () => {
  expect(printingMatchesRequest({ ...payload, collector_number: '259' }, entry)).toBe(false);
});

test('printingMatchesRequest normalizes leading-zero collector numbers', () => {
  expect(
    printingMatchesRequest(
      { ...payload, collector_number: '78' },
      { ...entry, collector_number: '078' },
    ),
  ).toBe(true);
});

test('normalizeDoubleFacedCardName converts single-slash deck names', () => {
  expect(
    normalizeDoubleFacedCardName('Nicol Bolas, the Ravager / Nicol Bolas, the Arisen'),
  ).toBe('Nicol Bolas, the Ravager // Nicol Bolas, the Arisen');
});

test('scryfallCardMatchesPrintingsLookup accepts Scryfall name when deck uses slash', () => {
  const lookup = resolvePrintingsLookup({
    name: 'Nicol Bolas, the Ravager / Nicol Bolas, the Arisen',
  });
  expect(
    scryfallCardMatchesPrintingsLookup(
      { name: 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen' },
      lookup,
    ),
  ).toBe(true);
});

test('buildDefaultPrintingsSearchQuery uses oracle_id when available', () => {
  const lookup = resolvePrintingsLookup({
    name: 'Wrong Name',
    detail: {
      name: 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen',
      oracle_id: 'abc-123',
    } as CardEntryDetail,
  });
  expect(buildDefaultPrintingsSearchQuery(lookup)).toBe('oracle_id:abc-123 unique:prints');
});

test('resolvePrintingsLookupName builds from card_faces when detail.name missing', () => {
  expect(
    resolvePrintingsLookupName({
      name: 'Nicol Bolas, the Ravager / Nicol Bolas, the Arisen',
      detail: {
        card_faces: [{ name: 'Nicol Bolas, the Ravager' }, { name: 'Nicol Bolas, the Arisen' }],
      } as CardEntryDetail,
    }),
  ).toBe('Nicol Bolas, the Ravager // Nicol Bolas, the Arisen');
});

test('scryfallCardMatchesPrintingsLookup tolerates missing deck name when detail has name', () => {
  const lookup = resolvePrintingsLookup({
    detail: { name: 'Lightning Bolt' } as CardEntryDetail,
  });
  expect(scryfallCardMatchesPrintingsLookup({ name: 'Lightning Bolt' }, lookup)).toBe(true);
});
