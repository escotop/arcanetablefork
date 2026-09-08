import { expect, test } from 'vitest';
import {
  galleryEntryMatchesCardName,
  getGallerySearchName,
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
