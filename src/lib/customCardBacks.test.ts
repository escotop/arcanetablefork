import { beforeEach, expect, test, vi } from 'vitest';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
});

test('custom card backs get a stable id, a title from the file name, and load through weserv', async () => {
  const { cardBackImageUrl, createCustomCardBack, isCustomCardBackId } = await import(
    './customCardBacks'
  );
  const url = 'https://example.com/backs/my_cool-back.png';
  const back = createCustomCardBack(url);
  expect(back).toMatchObject({ title: 'my cool back', imageUrl: url, sourceName: 'Custom' });
  expect(createCustomCardBack(url, 'Otro nombre').id).toBe(back.id);
  expect(isCustomCardBackId(back.id)).toBe(true);

  // Any host works for customs; catalog backs keep using our own proxy.
  expect(cardBackImageUrl(url, back.id)).toMatch(/^https:\/\/images\.weserv\.nl\/\?url=/);
  expect(cardBackImageUrl(url, 'mpc-123')).toBe(`/image-proxy?uri=${encodeURIComponent(url)}`);
});

test('parseCardBackUrl only accepts http(s) URLs', async () => {
  const { parseCardBackUrl } = await import('./customCardBacks');
  expect(parseCardBackUrl('  https://example.com/a.png ')).toBe('https://example.com/a.png');
  expect(parseCardBackUrl('javascript:alert(1)')).toBeUndefined();
  expect(parseCardBackUrl('not a url')).toBeUndefined();
});

test('custom card backs are saved in this browser and survive a reload', async () => {
  const first = await import('./customCardBacks');
  const a = first.createCustomCardBack('https://example.com/a.png');
  const b = first.createCustomCardBack('https://example.com/b.png');
  first.addCustomCardBack(a);
  first.addCustomCardBack(b);
  first.addCustomCardBack(a); // re-adding moves it to the front, no duplicate
  expect(first.customCardBacks().map(item => item.id)).toEqual([a.id, b.id]);

  vi.resetModules();
  const reloaded = await import('./customCardBacks');
  expect(reloaded.customCardBacks().map(item => item.id)).toEqual([a.id, b.id]);
  reloaded.removeCustomCardBack(a.id);
  expect(reloaded.customCardBacks().map(item => item.id)).toEqual([b.id]);
});
