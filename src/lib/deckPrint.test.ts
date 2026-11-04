import { expect, test } from 'vitest';
import {
  collectUniquePrintImageUrls,
  estimatePrintDeckLayout,
  mirroredPrintCardCol,
  mirroredPrintCardPositionMm,
  printCardPositionMm,
  printImagePixelSize,
} from './deckPrintLayout';

const defaultLayoutOptions = {
  spacingMm: 0.2,
  scale: 1,
  pageMarginMm: 5,
  pageSize: 'a4' as const,
};

test('mirroredPrintCardCol flips columns for duplex alignment', () => {
  expect(mirroredPrintCardCol(0, 3)).toBe(2);
  expect(mirroredPrintCardCol(1, 3)).toBe(1);
  expect(mirroredPrintCardCol(2, 3)).toBe(0);
});

test('mirroredPrintCardPositionMm mirrors horizontal slot on back page', () => {
  const layout = estimatePrintDeckLayout(defaultLayoutOptions);

  const frontLeft = printCardPositionMm(0, 0, defaultLayoutOptions, layout);
  const backRight = mirroredPrintCardPositionMm(0, 0, defaultLayoutOptions, layout);
  const frontRight = printCardPositionMm(layout.cols - 1, 0, defaultLayoutOptions, layout);

  expect(backRight.x).toBe(frontRight.x);
  expect(backRight.y).toBe(frontLeft.y);
});

test('printImagePixelSize matches 300 DPI for standard card slots', () => {
  const layout = estimatePrintDeckLayout(defaultLayoutOptions);
  const pixels = printImagePixelSize(layout.cardWidthMm, layout.cardHeightMm);
  expect(pixels.width).toBe(745);
  expect(pixels.height).toBe(1040);
});

test('collectUniquePrintImageUrls deduplicates repeated print slots', () => {
  const urls = collectUniquePrintImageUrls(
    [
      { imageUrl: 'a' },
      { imageUrl: 'a' },
      { imageUrl: 'b' },
    ],
    'back',
  );
  expect(urls.sort()).toEqual(['a', 'b', 'back']);
});
