export const MTG_CARD_WIDTH_MM = 63;
export const MTG_CARD_HEIGHT_MM = 88;

export type PrintPageSize = 'a4' | 'letter';

export interface PrintDeckLayoutOptions {
  spacingMm: number;
  scale: number;
  pageMarginMm: number;
  pageSize: PrintPageSize;
}

export interface PrintDeckLayout {
  cols: number;
  rows: number;
  cardsPerPage: number;
  cardWidthMm: number;
  cardHeightMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
}

const PAGE_SIZES: Record<PrintPageSize, [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};

export function estimatePrintDeckLayout(options: PrintDeckLayoutOptions): PrintDeckLayout {
  const [pageWidthMm, pageHeightMm] = PAGE_SIZES[options.pageSize];
  const cardWidthMm = MTG_CARD_WIDTH_MM * options.scale;
  const cardHeightMm = MTG_CARD_HEIGHT_MM * options.scale;
  const gap = options.spacingMm;
  const margin = options.pageMarginMm;
  const usableWidth = pageWidthMm - margin * 2;
  const usableHeight = pageHeightMm - margin * 2;
  const cols = Math.max(1, Math.floor((usableWidth + gap) / (cardWidthMm + gap)));
  const rows = Math.max(1, Math.floor((usableHeight + gap) / (cardHeightMm + gap)));

  return {
    cols,
    rows,
    cardsPerPage: cols * rows,
    cardWidthMm,
    cardHeightMm,
    pageWidthMm,
    pageHeightMm,
  };
}

export function printCardPositionMm(
  col: number,
  row: number,
  options: Pick<PrintDeckLayoutOptions, 'pageMarginMm' | 'spacingMm'>,
  layout: Pick<PrintDeckLayout, 'cardWidthMm' | 'cardHeightMm'>,
) {
  const x = options.pageMarginMm + col * (layout.cardWidthMm + options.spacingMm);
  const y = options.pageMarginMm + row * (layout.cardHeightMm + options.spacingMm);
  return { x, y };
}

/** Column index mirrored horizontally for duplex back pages. */
export function mirroredPrintCardCol(col: number, cols: number) {
  return cols - 1 - col;
}

export function mirroredPrintCardPositionMm(
  col: number,
  row: number,
  options: Pick<PrintDeckLayoutOptions, 'pageMarginMm' | 'spacingMm'>,
  layout: Pick<PrintDeckLayout, 'cols' | 'cardWidthMm' | 'cardHeightMm'>,
) {
  const mirrorCol = mirroredPrintCardCol(col, layout.cols);
  return printCardPositionMm(mirrorCol, row, options, layout);
}
