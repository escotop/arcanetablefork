import { expect, test, vi } from 'vitest';
import {
  galleryEntryMatchesCardName,
  galleryTokenEntryMatches,
  getGallerySearchName,
  isTokenCardDetail,
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

test('token customs match by card name, or by an unnamed title with the name and "token"', () => {
  // Real gallery entries returned for "Goblin token" / "Treasure token".
  expect(galleryTokenEntryMatches('Goblin', 'Goblin', 'Toby Goblin Token')).toBe(true);
  expect(galleryTokenEntryMatches('Goblin', 'null', 'Zesty Goblin Token_5')).toBe(true);
  expect(galleryTokenEntryMatches('Goblin', 'null', 'goblin token 1/1 haste deathtouch')).toBe(true);
  expect(galleryTokenEntryMatches('Treasure', 'null', 'Momoyo Himemushi Treasure Token')).toBe(true);

  // A named card that isn't the token, or a title without the name or the word token.
  expect(galleryTokenEntryMatches('Goblin', 'Krenko, Mob Boss', 'Krenko, Mob Boss (scry)3')).toBe(false);
  expect(galleryTokenEntryMatches('Treasure', 'null', 'desert pyramid_')).toBe(false);
  expect(galleryTokenEntryMatches('Treasure', 'null', 'Treasure chest art')).toBe(false);
  expect(galleryTokenEntryMatches('Elf', 'null', 'Elfball Token')).toBe(false);
});

test('isTokenCardDetail detects tokens from layout or type line', () => {
  expect(isTokenCardDetail({ type_line: 'Token Creature — Goblin' })).toBe(true);
  expect(isTokenCardDetail({ type_line: 'Token Artifact — Treasure' })).toBe(true);
  expect(isTokenCardDetail({ type_line: 'Creature — Goblin Warrior' })).toBe(false);
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
