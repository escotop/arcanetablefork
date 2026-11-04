import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  resetDeckEditorCatalogSearchStateForTests,
  SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS,
  searchDeckEditorCatalog,
} from './deckEditorCatalogSearch';

const searchCards = vi.fn();
const searchMtgApiCards = vi.fn();

vi.mock('./scryfall/client', () => ({
  searchCards: (...args: unknown[]) => searchCards(...args),
  ScryfallRequestError: class ScryfallRequestError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`Scryfall request failed (${status})`);
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock('./mtgApi/client', () => ({
  searchMtgApiCards: (...args: unknown[]) => searchMtgApiCards(...args),
}));

const scryfallList = {
  id: 'scryfall',
  object: 'list' as const,
  page: 1,
  total_cards: 1,
  total_pages: 1,
  data: [{ name: 'Lightning Bolt' }],
};

const mtgList = {
  id: 'mtgapi',
  object: 'list' as const,
  page: 1,
  total_cards: 1,
  total_pages: 1,
  data: [{ name: 'Lightning Bolt' }],
};

beforeEach(() => {
  vi.useFakeTimers();
  resetDeckEditorCatalogSearchStateForTests();
  searchCards.mockReset();
  searchMtgApiCards.mockReset();
  searchMtgApiCards.mockResolvedValue(mtgList);
});

afterEach(() => {
  vi.useRealTimers();
});

test('returns Scryfall results when search finishes quickly', async () => {
  searchCards.mockResolvedValue(scryfallList);

  const promise = searchDeckEditorCatalog('bolt');
  await vi.runAllTimersAsync();
  const result = await promise;

  expect(result.source).toBe('scryfall');
  expect(result.data[0].name).toBe('Lightning Bolt');
  expect(searchMtgApiCards).not.toHaveBeenCalled();
});

test('falls back to MTG API on Scryfall error', async () => {
  searchCards.mockRejectedValue(new Error('network down'));

  const promise = searchDeckEditorCatalog('bolt');
  await vi.runAllTimersAsync();
  const result = await promise;

  expect(result.source).toBe('mtgapi');
  expect(searchMtgApiCards).toHaveBeenCalledWith('bolt', {});
});

test('falls back to MTG API when Scryfall exceeds 5 seconds', async () => {
  searchCards.mockImplementation(
    () =>
      new Promise(resolve => {
        setTimeout(() => resolve(scryfallList), SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS + 500);
      }),
  );

  const promise = searchDeckEditorCatalog('bolt');
  await vi.advanceTimersByTimeAsync(SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS);
  const result = await promise;

  expect(result.source).toBe('mtgapi');
  expect(searchMtgApiCards).toHaveBeenCalled();
});

test('uses MTG API directly while Scryfall cooldown is active', async () => {
  searchCards.mockRejectedValue(new Error('timeout'));
  await searchDeckEditorCatalog('first');
  await vi.runAllTimersAsync();

  searchCards.mockClear();
  searchMtgApiCards.mockClear();

  const result = await searchDeckEditorCatalog('second');
  expect(result.source).toBe('mtgapi');
  expect(searchCards).not.toHaveBeenCalled();
  expect(searchMtgApiCards).toHaveBeenCalledWith('second', {});
});
