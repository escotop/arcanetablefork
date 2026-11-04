import { expect, test } from 'vitest';
import {
  estimatePrintDeckLayout,
  mirroredPrintCardCol,
  mirroredPrintCardPositionMm,
  printCardPositionMm,
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
