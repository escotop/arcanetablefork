import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  resetDeckEditorCatalogSearchStateForTests,
  searchDeckEditorCatalog,
} from './deckEditorCatalogSearch';

const searchCards = vi.fn();
const searchMtgApiCards = vi.fn();

vi.mock('./scryfall/client', () => {
  class ScryfallRequestError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`Scryfall request failed (${status})`);
      this.status = status;
      this.body = body;
    }
  }
  class ScryfallUnavailableError extends ScryfallRequestError {}
  return {
    searchCards: (...args: unknown[]) => searchCards(...args),
    ScryfallRequestError,
    ScryfallUnavailableError,
    isScryfallUnavailableError: (error: unknown) => error instanceof ScryfallUnavailableError,
  };
});

vi.mock('./mtgApi/client', () => ({
  searchMtgApiCards: (...args: unknown[]) => searchMtgApiCards(...args),
  isMtgApiAvailable: () => true,
}));

const searchBulkCards = vi.fn();
vi.mock('./scryfallBulkIndex', () => ({
  searchBulkCards: (...args: unknown[]) => searchBulkCards(...args),
  scheduleBulkIndexRefresh: async () => {},
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
  resetDeckEditorCatalogSearchStateForTests();
  searchCards.mockReset();
  searchMtgApiCards.mockReset();
  searchMtgApiCards.mockResolvedValue(mtgList);
  searchBulkCards.mockReset();
  searchBulkCards.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

test('returns Scryfall results when search succeeds', async () => {
  searchCards.mockResolvedValue(scryfallList);

  const result = await searchDeckEditorCatalog('bolt');

  expect(result.source).toBe('scryfall');
  expect(result.data[0].name).toBe('Lightning Bolt');
  expect(searchMtgApiCards).not.toHaveBeenCalled();
  expect(searchCards).toHaveBeenCalledWith(
    'bolt',
    {},
    expect.objectContaining({ priority: 'interactive', requestTimeoutMs: 5000 }),
  );
});

test('repeated searches are served from the cache', async () => {
  searchCards.mockResolvedValue(scryfallList);
  await searchDeckEditorCatalog('bolt');
  await searchDeckEditorCatalog('Bolt ');
  expect(searchCards).toHaveBeenCalledTimes(1);
});

test('prefers the offline Scryfall index over MTG API when Scryfall is down', async () => {
  searchCards.mockRejectedValue(new Error('Scryfall unavailable'));
  searchBulkCards.mockResolvedValue({ ...scryfallList, id: 'scryfall-bulk' });
  const result = await searchDeckEditorCatalog('bolt');
  expect(result.source).toBe('scryfall-offline');
  expect(searchMtgApiCards).not.toHaveBeenCalled();
});

test('invalid query syntax returns no results instead of switching provider', async () => {
  const { ScryfallRequestError } = await import('./scryfall/client');
  searchCards.mockRejectedValue(new ScryfallRequestError(400, 'bad query'));
  const result = await searchDeckEditorCatalog('o:"');
  expect(result.source).toBe('scryfall');
  expect(result.data).toEqual([]);
  expect(searchMtgApiCards).not.toHaveBeenCalled();
});

test('falls back to MTG API immediately on Scryfall error', async () => {
  searchCards.mockRejectedValue(new Error('Scryfall request failed (429)'));

  const result = await searchDeckEditorCatalog('bolt');

  expect(result.source).toBe('mtgapi');
  expect(searchMtgApiCards).toHaveBeenCalledWith('bolt', {});
});

test('uses MTG API directly while Scryfall cooldown is active', async () => {
  searchCards.mockRejectedValue(new Error('429'));
  await searchDeckEditorCatalog('first');

  searchCards.mockClear();
  searchMtgApiCards.mockClear();

  const result = await searchDeckEditorCatalog('second');
  expect(result.source).toBe('mtgapi');
  expect(searchCards).not.toHaveBeenCalled();
  expect(searchMtgApiCards).toHaveBeenCalledWith('second', {});
});
