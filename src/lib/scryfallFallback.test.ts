import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { tryPostCardCollection } from './scryfall/client';
import {
  activateScryfallFallback,
  isScryfallFallbackActive,
  resetScryfallFallbackForTests,
  SCRYFALL_FALLBACK_DURATION_MS,
} from './scryfallFallback';

beforeEach(() => {
  resetScryfallFallbackForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('activates fallback for five minutes after one failure', () => {
  activateScryfallFallback('test', 'HTTP 429');
  expect(isScryfallFallbackActive()).toBe(true);

  vi.advanceTimersByTime(SCRYFALL_FALLBACK_DURATION_MS - 1);
  expect(isScryfallFallbackActive()).toBe(true);

  vi.advanceTimersByTime(1);
  expect(isScryfallFallbackActive()).toBe(false);
});

test('refreshing fallback extends the window', () => {
  activateScryfallFallback('first', '429');
  vi.advanceTimersByTime(SCRYFALL_FALLBACK_DURATION_MS - 60_000);
  activateScryfallFallback('second', '429 again');
  vi.advanceTimersByTime(SCRYFALL_FALLBACK_DURATION_MS - 1);
  expect(isScryfallFallbackActive()).toBe(true);
});

test('tryPostCardCollection skips network while fallback is active', async () => {
  activateScryfallFallback('cards/collection', 'HTTP 429');
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const result = await tryPostCardCollection([{ name: 'Sol Ring' }]);
  expect(result).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
