import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  getCardNamed,
  getScryfallRouteStatus,
  lookupCardById,
  lookupCardNamed,
  resetScryfallClientForTests,
  scryfallFetch,
  ScryfallUnavailableError,
} from './client';
import { isScryfallFallbackActive, resetScryfallFallbackForTests } from '../scryfallFallback';

const card = (name: string) => ({ object: 'card', id: `id-${name}`, name, type_line: 'Artifact' });

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

let calls: string[] = [];

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  });
}

const isDirect = (url: string) => url.startsWith('https://api.scryfall.com/');

beforeEach(() => {
  resetScryfallClientForTests();
  resetScryfallFallbackForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('calls Scryfall directly first (per-player rate limit)', async () => {
  mockFetch(() => json(card('Sol Ring')));
  const result = await lookupCardById('abc');
  expect(result?.name).toBe('Sol Ring');
  expect(calls).toEqual(['https://api.scryfall.com/cards/abc']);
});

test('a 429 on one route switches to the other at once and respects the cooldown', async () => {
  mockFetch(url => (isDirect(url) ? json({ object: 'error' }, 429) : json(card('Sol Ring'))));
  const started = Date.now();
  expect((await lookupCardById('a'))?.name).toBe('Sol Ring');
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(calls.map(isDirect)).toEqual([true, false]);

  // Direct is cooling down: the next request must not touch it.
  calls = [];
  await lookupCardById('b');
  expect(calls.map(isDirect)).toEqual([false]);
  expect(getScryfallRouteStatus().direct.coolingMs).toBeGreaterThan(20_000);
});

test('rate limited everywhere: fails fast with ScryfallUnavailableError and opens the fallback', async () => {
  mockFetch(() => json({ object: 'error' }, 429));
  const started = Date.now();
  await expect(lookupCardNamed('Sol Ring')).rejects.toBeInstanceOf(ScryfallUnavailableError);
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(calls).toHaveLength(2);
  expect(isScryfallFallbackActive()).toBe(true);

  // Following requests do not hammer the limited routes.
  calls = [];
  await expect(lookupCardById('x', { cooldownBudgetMs: 0 })).rejects.toBeInstanceOf(
    ScryfallUnavailableError,
  );
  expect(calls).toHaveLength(0);
});

test('get* helpers keep returning null when Scryfall is unavailable', async () => {
  mockFetch(() => json({ object: 'error' }, 429));
  await expect(getCardNamed('Sol Ring')).resolves.toBeNull();
});

test('404 means "no such card", not unavailable', async () => {
  mockFetch(() => json({ object: 'error', status: 404 }, 404));
  await expect(lookupCardNamed('Not A Card')).resolves.toBeNull();
  expect(isScryfallFallbackActive()).toBe(false);
});

test('a network error on direct (blocked) falls back to the proxy and sticks', async () => {
  mockFetch(url => {
    if (isDirect(url)) throw new TypeError('Failed to fetch');
    return json(card('Sol Ring'));
  });
  expect((await lookupCardById('a'))?.name).toBe('Sol Ring');
  calls = [];
  await lookupCardById('b');
  expect(calls.map(isDirect)).toEqual([false]);
  expect(getScryfallRouteStatus().direct.disabledMs).toBeGreaterThan(0);
});

test('Retry-After is honoured as the cooldown', async () => {
  mockFetch(url => (isDirect(url) ? json({}, 429, { 'Retry-After': '2' }) : json(card('x'))));
  await lookupCardById('a');
  const cooling = getScryfallRouteStatus().direct.coolingMs;
  expect(cooling).toBeGreaterThan(1_000);
  expect(cooling).toBeLessThanOrEqual(2_000);
});

test('interactive requests are served before queued background ones', async () => {
  const order: string[] = [];
  mockFetch(url => {
    order.push(new URL(url).searchParams.get('q') ?? '');
    return json({ object: 'list', data: [] });
  });
  const background = ['b1', 'b2', 'b3'].map(q => scryfallFetch(`/cards/search?q=${q}`));
  const interactive = scryfallFetch('/cards/search?q=user', undefined, { priority: 'interactive' });
  await Promise.all([...background, interactive]);
  // b1 had already been granted the first slot; the user's search goes next.
  expect(order).toEqual(['b1', 'user', 'b2', 'b3']);
});

test('accepts proxy-style and absolute Scryfall URLs', async () => {
  mockFetch(() => json(card('x')));
  await scryfallFetch('/api/scryfall/cards/a');
  await scryfallFetch('https://api.scryfall.com/cards/b');
  expect(calls).toEqual(['https://api.scryfall.com/cards/a', 'https://api.scryfall.com/cards/b']);
});

test('builds rate-limit-free image URLs from a Scryfall id', async () => {
  const { scryfallImageUrlFromId } = await import('./client');
  expect(scryfallImageUrlFromId('0000579f-7b35-4ed3-b44c-db2a538066fe', 'art_crop')).toBe(
    'https://cards.scryfall.io/art_crop/front/0/0/0000579f-7b35-4ed3-b44c-db2a538066fe.jpg',
  );
  expect(scryfallImageUrlFromId('not-an-id')).toBeUndefined();
});
