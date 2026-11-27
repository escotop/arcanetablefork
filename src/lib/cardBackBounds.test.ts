import { expect, test } from 'vitest';
import { describePrintQuality, findTrimBounds } from './cardBackBounds';
import { searchHearthstoneCardBacks } from './hearthstoneCardBacks';

function imageWithOpaqueBox(width: number, height: number, box: { x: number; y: number; w: number; h: number }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) data[(y * width + x) * 4 + 3] = 255;
  }
  return data;
}

test('findTrimBounds finds the card inside transparent margins (Hearthstone layout)', () => {
  // CardBack0.png is 512x666 with the card at x 55..457, y 37..634.
  const data = imageWithOpaqueBox(512, 666, { x: 55, y: 37, w: 403, h: 598 });
  expect(findTrimBounds(data, 512, 666)).toEqual({ x: 55, y: 37, width: 403, height: 598 });
});

test('findTrimBounds leaves full-bleed images alone', () => {
  expect(findTrimBounds(imageWithOpaqueBox(100, 140, { x: 0, y: 0, w: 100, h: 140 }), 100, 140)).toBeUndefined();
  // Rounded corners only: a 1px margin is not worth trimming.
  expect(findTrimBounds(imageWithOpaqueBox(500, 700, { x: 1, y: 1, w: 498, h: 698 }), 500, 700)).toBeUndefined();
  expect(findTrimBounds(new Uint8ClampedArray(100 * 140 * 4), 100, 140)).toBeUndefined();
});

test('Hearthstone card backs search Spanish and English names and paginate', () => {
  const first = searchHearthstoneCardBacks('', 1);
  // Classic has a sharper copy; backs without one use the wiki image.
  expect(first.products[0]).toMatchObject({ id: 'hearthstone-0', title: 'Clásico' });
  expect(first.products[0].imageUrl).toMatch(/^https:\/\/i\.pinimg\.com\/originals\//);
  expect(first.products[1]).toMatchObject({
    id: 'hearthstone-158',
    imageUrl: 'https://hearthstone.wiki.gg/images/CardBack158.png',
  });
  expect(first.hasNext).toBe(true);
  expect(first.lastPage).toBeGreaterThan(5);

  expect(searchHearthstoneCardBacks('rey exanime', 1).products.map(p => p.id)).toContain('hearthstone-351');
  expect(searchHearthstoneCardBacks('lich king', 1).products.map(p => p.id)).toContain('hearthstone-351');
  expect(searchHearthstoneCardBacks('zzzz', 1)).toMatchObject({ products: [], hasNext: false, lastPage: 1 });
});

test('describePrintQuality rates the effective DPI at card size', () => {
  // Hearthstone back after trimming, on a 63x88 mm card.
  expect(describePrintQuality(403, 598, 63, 88)).toMatchObject({ dpi: 162, level: 'low' });
  expect(describePrintQuality(745, 1040, 63, 88)).toMatchObject({ dpi: 300, atMax: true });
  // Bigger images don't print sharper: the PDF is rasterized at 300 DPI.
  expect(describePrintQuality(1032, 1529, 63, 88)).toMatchObject({ dpi: 300, atMax: true, level: 'high' });
  expect(describePrintQuality(403, 598, 63, 88)).toMatchObject({ atMax: false });
  expect(describePrintQuality(600, 840, 63, 88)).toMatchObject({ level: 'medium' });
});
