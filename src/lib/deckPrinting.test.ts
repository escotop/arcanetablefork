import { expect, test } from 'vitest';
import { CardEntryDetail } from './constants';
import { printingMatchesRequest } from './deckPrinting';

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
