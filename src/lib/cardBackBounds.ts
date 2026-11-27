/**
 * Some card backs (e.g. Hearthstone's) come with wide transparent margins around the
 * card. These helpers find the visible card so it can fill the whole card face.
 */

export type ImageBounds = { x: number; y: number; width: number; height: number };

const ALPHA_VISIBLE = 16;
/** Margins thinner than this (fraction of the side) are left alone. */
const MIN_MARGIN_RATIO = 0.02;

/** Box around the visible pixels, or undefined when there is no margin worth trimming. */
export function findTrimBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageBounds | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] < ALPHA_VISIBLE) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return undefined;

  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const trimmedX = 1 - bounds.width / width;
  const trimmedY = 1 - bounds.height / height;
  if (trimmedX < MIN_MARGIN_RATIO && trimmedY < MIN_MARGIN_RATIO) return undefined;
  return bounds;
}

/** Visible-card box of an image (needs CORS-clean pixels; undefined if unreadable). */
export function findImageTrimBounds(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageBounds | undefined {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(source, 0, 0);
    return findTrimBounds(ctx.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return undefined;
  }
}

export type PrintQuality = { width: number; height: number; dpi: number; level: 'high' | 'medium' | 'low' };

/** Effective DPI of an image printed at the given card size (worst of both sides). */
export function describePrintQuality(
  width: number,
  height: number,
  cardWidthMm: number,
  cardHeightMm: number,
): PrintQuality {
  const dpi = Math.round(Math.min(width / (cardWidthMm / 25.4), height / (cardHeightMm / 25.4)));
  const level = dpi >= 280 ? 'high' : dpi >= 200 ? 'medium' : 'low';
  return { width, height, dpi, level };
}
