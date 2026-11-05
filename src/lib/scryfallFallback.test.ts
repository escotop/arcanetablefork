import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetScryfallClientForTests, tryPostCardCollection } from './scryfall/client';
import {
  activateScryfallFallback,
  isScryfallFallbackActive,
  onScryfallFallbackActivated,
  resetScryfallFallbackForTests,
  SCRYFALL_FALLBACK_DURATION_MS,
  SCRYFALL_FALLBACK_MAX_MS,
  SCRYFALL_FALLBACK_MIN_MS,
} from './scryfallFallback';

beforeEach(() => {
  resetScryfallFallbackForTests();
  resetScryfallClientForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('default window lasts SCRYFALL_FALLBACK_DURATION_MS', () => {
  activateScryfallFallback('test', 'HTTP 429');
  expect(isScryfallFallbackActive()).toBe(true);

  vi.advanceTimersByTime(SCRYFALL_FALLBACK_DURATION_MS - 1);
  expect(isScryfallFallbackActive()).toBe(true);

  vi.advanceTimersByTime(1);
  expect(isScryfallFallbackActive()).toBe(false);
});

test('window follows the requested duration within bounds', () => {
  activateScryfallFallback('short', '429', 1_000);
  vi.advanceTimersByTime(SCRYFALL_FALLBACK_MIN_MS - 1);
  expect(isScryfallFallbackActive()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(isScryfallFallbackActive()).toBe(false);

  activateScryfallFallback('long', '429', 60 * 60_000);
  vi.advanceTimersByTime(SCRYFALL_FALLBACK_MAX_MS);
  expect(isScryfallFallbackActive()).toBe(false);
});

test('repeat activations only extend the window', () => {
  activateScryfallFallback('first', '429', 90_000);
  activateScryfallFallback('second', '429', 10_000);
  vi.advanceTimersByTime(60_000);
  expect(isScryfallFallbackActive()).toBe(true);
});

test('listeners hear when the window opens', () => {
  const listener = vi.fn();
  const off = onScryfallFallbackActivated(listener);
  activateScryfallFallback('a', '429');
  activateScryfallFallback('b', '429');
  expect(listener).toHaveBeenCalledTimes(1);
  off();
});

test('tryPostCardCollection skips network while fallback is active', async () => {
  activateScryfallFallback('cards/collection', 'HTTP 429');
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const result = await tryPostCardCollection([{ name: 'Sol Ring' }]);
  expect(result).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
