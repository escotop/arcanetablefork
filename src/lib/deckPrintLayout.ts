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
  /** Left inset so the card grid is horizontally centered. */
  originXMm: number;
  /** Top inset so the card grid is vertically centered. */
  originYMm: number;
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
  const gridWidthMm = cols * cardWidthMm + Math.max(0, cols - 1) * gap;
  const gridHeightMm = rows * cardHeightMm + Math.max(0, rows - 1) * gap;

  return {
    cols,
    rows,
    cardsPerPage: cols * rows,
    cardWidthMm,
    cardHeightMm,
    pageWidthMm,
    pageHeightMm,
    originXMm: (pageWidthMm - gridWidthMm) / 2,
    originYMm: (pageHeightMm - gridHeightMm) / 2,
  };
}

export function printCardPositionMm(
  col: number,
  row: number,
  options: Pick<PrintDeckLayoutOptions, 'spacingMm'>,
  layout: Pick<PrintDeckLayout, 'cardWidthMm' | 'cardHeightMm' | 'originXMm' | 'originYMm'>,
) {
  const x = layout.originXMm + col * (layout.cardWidthMm + options.spacingMm);
  const y = layout.originYMm + row * (layout.cardHeightMm + options.spacingMm);
  return { x, y };
}

/** Column index mirrored horizontally for duplex back pages. */
export function mirroredPrintCardCol(col: number, cols: number) {
  return cols - 1 - col;
}

export function mirroredPrintCardPositionMm(
  col: number,
  row: number,
  options: Pick<PrintDeckLayoutOptions, 'spacingMm'>,
  layout: Pick<PrintDeckLayout, 'cols' | 'cardWidthMm' | 'cardHeightMm' | 'originXMm' | 'originYMm'>,
) {
  const mirrorCol = mirroredPrintCardCol(col, layout.cols);
  return printCardPositionMm(mirrorCol, row, options, layout);
}

/** 300 DPI — resolución típica de impresión para el tamaño de slot (63×88 mm). */
export const PRINT_PDF_IMAGE_DPI = 300;

export function printImagePixelSize(
  cardWidthMm: number,
  cardHeightMm: number,
  dpi = PRINT_PDF_IMAGE_DPI,
) {
  return {
    width: Math.max(1, Math.ceil((cardWidthMm / 25.4) * dpi)),
    height: Math.max(1, Math.ceil((cardHeightMm / 25.4) * dpi)),
  };
}

export function collectUniquePrintImageUrls(
  slots: { imageUrl: string }[],
  cardBackUrl?: string,
) {
  const urls = new Set(slots.map(slot => slot.imageUrl));
  if (cardBackUrl) urls.add(cardBackUrl);
  return [...urls];
}

/** Alpha below this is treated as empty (outside the rounded card art). */
export const PRINT_TRANSPARENT_ALPHA_THRESHOLD = 250;

/** Replace transparent/low-alpha pixels with opaque black; leave opaque card art untouched. */
export function fillTransparentPixelsBlack(
  data: Uint8ClampedArray,
  alphaThreshold = PRINT_TRANSPARENT_ALPHA_THRESHOLD,
) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaThreshold) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
}
