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

/** "Absolute" white, with room for JPEG noise (Scryfall JPG corners read 240-255). */
export const PRINT_WHITE_CORNER_MIN = 240;
/** Rounded-corner radius as a fraction of card width; nothing inside this curve is touched. */
export const PRINT_CORNER_RADIUS_RATIO = 0.045;
const WHITE_CORNERS_REQUIRED = 3;
/** Anti-aliased edge pixels brighter than this (and not white) get darkened. */
const CORNER_EDGE_MIN = 64;
const CORNER_EDGE_PASSES = 3;

/**
 * Some images come with opaque white corners instead of transparent ones (e.g. Scryfall
 * JPGs such as Diabolic Revelation). When at least 3 corners are white, paint the white
 * area outside the rounded corner black, and darken the anti-aliased edge next to it.
 * Returns whether anything was painted.
 */
export function fillWhiteCornersBlack(data: Uint8ClampedArray, width: number, height: number) {
  const radius = Math.max(2, Math.round(width * PRINT_CORNER_RADIUS_RATIO));
  if (width < radius * 2 || height < radius * 2) return false;

  const corners = [
    { x0: 0, y0: 0, dx: 1, dy: 1 },
    { x0: width - 1, y0: 0, dx: -1, dy: 1 },
    { x0: 0, y0: height - 1, dx: 1, dy: -1 },
    { x0: width - 1, y0: height - 1, dx: -1, dy: -1 },
  ];

  const minChannel = (i: number) => Math.min(data[i], data[i + 1], data[i + 2]);
  const isWhite = (i: number) => minChannel(i) >= PRINT_WHITE_CORNER_MIN;

  const whiteCorners = corners.filter(({ x0, y0, dx, dy }) =>
    [0, 1].every(ly =>
      [0, 1].every(lx => isWhite(((y0 + dy * ly) * width + x0 + dx * lx) * 4)),
    ),
  );
  if (whiteCorners.length < WHITE_CORNERS_REQUIRED) return false;

  const box = radius + CORNER_EDGE_PASSES;
  for (const { x0, y0, dx, dy } of whiteCorners) {
    const index = (lx: number, ly: number) => ((y0 + dy * ly) * width + x0 + dx * lx) * 4;
    const outsideCurve = (lx: number, ly: number) =>
      lx < radius && ly < radius && Math.hypot(radius - lx, radius - ly) >= radius;

    // White pixels connected to the corner tip, outside the rounded corner.
    const painted = new Set<number>();
    const stack: [number, number][] = [[0, 0]];
    while (stack.length) {
      const [lx, ly] = stack.pop()!;
      const key = ly * box + lx;
      if (lx < 0 || ly < 0 || painted.has(key) || !outsideCurve(lx, ly)) continue;
      if (!isWhite(index(lx, ly))) continue;
      painted.add(key);
      stack.push([lx + 1, ly], [lx - 1, ly], [lx, ly + 1], [lx, ly - 1]);
    }

    for (const key of painted) {
      const i = index(key % box, Math.floor(key / box));
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = 255;
    }

    // The anti-aliased curve blended card and white; blend it with black instead.
    let frontier = painted;
    for (let pass = 0; pass < CORNER_EDGE_PASSES; pass++) {
      const edge = new Set<number>();
      for (const key of frontier) {
        const lx = key % box;
        const ly = Math.floor(key / box);
        for (let ny = ly - 1; ny <= ly + 1; ny++) {
          for (let nx = lx - 1; nx <= lx + 1; nx++) {
            if (nx < 0 || ny < 0 || nx >= box || ny >= box) continue;
            const neighbor = ny * box + nx;
            if (painted.has(neighbor) || edge.has(neighbor)) continue;
            // Only the band along the curve, never deeper into the card.
            if (Math.hypot(radius - nx, radius - ny) < radius - CORNER_EDGE_PASSES) continue;
            const m = minChannel(index(nx, ny));
            if (m >= CORNER_EDGE_MIN && m < PRINT_WHITE_CORNER_MIN) edge.add(neighbor);
          }
        }
      }
      for (const key of edge) {
        const i = index(key % box, Math.floor(key / box));
        const keep = 1 - minChannel(i) / 255;
        data[i] = Math.round(data[i] * keep);
        data[i + 1] = Math.round(data[i + 1] * keep);
        data[i + 2] = Math.round(data[i + 2] * keep);
        painted.add(key);
      }
      frontier = edge;
    }
  }

  return true;
}

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
