import { expect, test, vi } from 'vitest';
import {
  galleryEntryMatchesCardName,
  getGallerySearchName,
  getTextureLoadUrl,
} from './customCardArt';

test('getGallerySearchName uses the front face of DFCs', () => {
  expect(getGallerySearchName('Delver of Secrets // Insectile Aberration')).toBe(
    'Delver of Secrets',
  );
});

test('galleryEntryMatchesCardName accepts exact search_card_name matches', () => {
  expect(galleryEntryMatchesCardName('Lightning Bolt', 'Lightning Bolt')).toBe(true);
  expect(galleryEntryMatchesCardName('Sol Ring', 'Sol Ring')).toBe(true);
  expect(
    galleryEntryMatchesCardName(
      'Delver of Secrets // Insectile Aberration',
      'Insectile Aberration',
    ),
  ).toBe(true);
});

test('galleryEntryMatchesCardName rejects unrelated gallery cards', () => {
  expect(galleryEntryMatchesCardName('Lightning Bolt', 'Lightning Strike')).toBe(false);
  expect(galleryEntryMatchesCardName('Sol Ring', null)).toBe(false);
  expect(galleryEntryMatchesCardName('Island', 'Treasure Island')).toBe(false);
});

test('galleryEntryMatchesCardName ignores creative edition titles', () => {
  expect(
    galleryEntryMatchesCardName('Lightning Bolt', null),
  ).toBe(false);
  expect(
    galleryEntryMatchesCardName('Sol Ring', null),
  ).toBe(false);
});

test('getTextureLoadUrl routes Scryfall CDN through same-origin image proxy', () => {
  vi.stubGlobal('location', { origin: 'https://untapped-table.narcolepticdracu.com' });
  const scryfallPng =
    'https://cards.scryfall.io/png/front/6/5/654a1564-0356-44ad-b1ab-8c1a556fc244.png?1783907183';
  const proxied = getTextureLoadUrl(scryfallPng);
  expect(proxied).toBe(
    `https://untapped-table.narcolepticdracu.com/image-proxy?uri=${encodeURIComponent(scryfallPng)}`,
  );
  vi.unstubAllGlobals();
});
