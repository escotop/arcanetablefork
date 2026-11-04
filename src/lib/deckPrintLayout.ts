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

/** Outer corner radius on a standard MTG card (~3.17 mm on 63 mm width). */
export function mtgPrintCornerRadiusPx(cardWidthPx: number) {
  return Math.max(2, Math.round(cardWidthPx * (3.17 / MTG_CARD_WIDTH_MM)));
}

const BLACK_CORNER_LUMINANCE_THRESHOLD = 48;

function pixelLuminance(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function cornerCapHasLightPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  corner: 'tl' | 'tr' | 'bl' | 'br',
) {
  const rcx = corner === 'tr' || corner === 'br' ? width - radius : radius;
  const rcy = corner === 'bl' || corner === 'br' ? height - radius : radius;
  const step = Math.max(1, Math.floor(radius / 8));

  for (let y = 0; y < radius; y += step) {
    for (let x = 0; x < radius; x += step) {
      const px =
        corner === 'tr' || corner === 'br' ? width - 1 - x : x;
      const py =
        corner === 'bl' || corner === 'br' ? height - 1 - y : y;
      const lx = corner === 'tr' || corner === 'br' ? width - 1 - x : x;
      const ly = corner === 'bl' || corner === 'br' ? height - 1 - y : y;
      const distSq = (lx - rcx) ** 2 + (ly - rcy) ** 2;
      if (distSq > radius * radius && pixelLuminance(data, width, px, py) > BLACK_CORNER_LUMINANCE_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

/** True when corner caps outside the MTG round radius are not already black. */
export function detectNeedsBlackCornerFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
) {
  if (radius < 2) return false;
  return (
    cornerCapHasLightPixel(data, width, height, radius, 'tl') ||
    cornerCapHasLightPixel(data, width, height, radius, 'tr') ||
    cornerCapHasLightPixel(data, width, height, radius, 'bl') ||
    cornerCapHasLightPixel(data, width, height, radius, 'br')
  );
}

export function paintBlackCornerCaps(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
) {
  if (radius < 2) return;
  ctx.fillStyle = '#000000';
  const corners: { rcx: number; rcy: number; startAngle: number; endAngle: number }[] = [
    { rcx: radius, rcy: radius, startAngle: Math.PI, endAngle: 1.5 * Math.PI },
    { rcx: width - radius, rcy: radius, startAngle: 1.5 * Math.PI, endAngle: 0 },
    { rcx: radius, rcy: height - radius, startAngle: 0.5 * Math.PI, endAngle: Math.PI },
    { rcx: width - radius, rcy: height - radius, startAngle: 0, endAngle: 0.5 * Math.PI },
  ];
  for (const { rcx, rcy, startAngle, endAngle } of corners) {
    ctx.beginPath();
    ctx.moveTo(rcx, rcy);
    ctx.arc(rcx, rcy, radius, startAngle, endAngle, false);
    ctx.closePath();
    ctx.fill();
  }
}
