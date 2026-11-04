import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  resetDeckEditorCatalogSearchStateForTests,
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
  resetDeckEditorCatalogSearchStateForTests();
  searchCards.mockReset();
  searchMtgApiCards.mockReset();
  searchMtgApiCards.mockResolvedValue(mtgList);
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
    expect.objectContaining({ maxAttempts: 1, requestTimeoutMs: 5000 }),
  );
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
