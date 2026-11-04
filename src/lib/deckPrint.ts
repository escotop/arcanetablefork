import { getCardImage } from './card';
import {
  getTextureLoadUrlCandidates,
} from './customCardArt';
import { DetailedCardEntry } from './constants';
import {
  collectUniquePrintImageUrls,
  estimatePrintDeckLayout,
  fillTransparentPixelsBlack,
  mirroredPrintCardPositionMm,
  printCardPositionMm,
  printImagePixelSize,
  type PrintPageSize,
} from './deckPrintLayout';

export {
  estimatePrintDeckLayout,
  mirroredPrintCardCol,
  mirroredPrintCardPositionMm,
  MTG_CARD_HEIGHT_MM,
  MTG_CARD_WIDTH_MM,
  printCardPositionMm,
  printImagePixelSize,
  PRINT_PDF_IMAGE_DPI,
  collectUniquePrintImageUrls,
  fillTransparentPixelsBlack,
} from './deckPrintLayout';
export type { PrintDeckLayout, PrintPageSize } from './deckPrintLayout';

export type PrintDeckCardBack = {
  id: string;
  title: string;
  imageUrl: string;
};

export interface PrintDeckOptions {
  spacingMm: number;
  scale: number;
  pageMarginMm: number;
  pageSize: PrintPageSize;
  includeSideboard: boolean;
  includeTokens: boolean;
  addCardBacks: boolean;
  blackCorners: boolean;
  cardBack?: PrintDeckCardBack;
}

export interface PrintDeckProgress {
  phase: 'loading' | 'rendering';
  current: number;
  total: number;
  message?: string;
}

type PdfImageFormat = 'PNG' | 'JPEG';

type PdfRasterImage = {
  dataUrl: string;
  format: PdfImageFormat;
  alias: string;
};

const PDF_RASTER_FORMAT: PdfImageFormat = 'PNG';
/** Parallel image fetches; browsers limit ~6 connections per origin but proxy may differ. */
const PRINT_PDF_FETCH_CONCURRENCY = 8;

export function getDefaultPrintDeckOptions(): PrintDeckOptions {
  return {
    spacingMm: 0.2,
    scale: 1,
    pageMarginMm: 5,
    pageSize: 'a4',
    includeSideboard: false,
    includeTokens: false,
    addCardBacks: false,
    blackCorners: false,
  };
}

export function buildPrintDeckCardList(
  main: DetailedCardEntry[],
  sideboard: DetailedCardEntry[] = [],
  tokens: DetailedCardEntry[] = [],
  options: Pick<PrintDeckOptions, 'includeSideboard' | 'includeTokens'>,
) {
  let cards = [...main];
  if (options.includeSideboard) cards = cards.concat(sideboard);
  if (options.includeTokens) cards = cards.concat(tokens);
  return cards;
}

function isDoubleFacedForPrint(card: DetailedCardEntry): boolean {
  const faces = card.detail?.card_faces;
  if (!faces || faces.length < 2) return false;
  return !!getCardImage(card, 1);
}

function getPrintFaceSlots(card: DetailedCardEntry): { name: string; imageUrl: string }[] {
  const frontUrl = getCardImage(card, 0);
  if (!frontUrl) return [];

  if (!isDoubleFacedForPrint(card)) {
    return [{ name: card.name, imageUrl: frontUrl }];
  }

  const backUrl = getCardImage(card, 1);
  if (!backUrl) {
    return [{ name: card.name, imageUrl: frontUrl }];
  }

  const frontName = card.detail?.card_faces?.[0]?.name ?? card.name;
  const backName = card.detail?.card_faces?.[1]?.name ?? `${card.name} (back)`;

  return [
    { name: frontName, imageUrl: frontUrl },
    { name: backName, imageUrl: backUrl },
  ];
}

export function expandDeckForPrint(cards: DetailedCardEntry[]) {
  const slots: { name: string; imageUrl: string }[] = [];

  for (const card of cards) {
    if (!card.qty) continue;

    const faceSlots = getPrintFaceSlots(card);
    if (!faceSlots.length) continue;

    for (let copy = 0; copy < card.qty; copy++) {
      for (const slot of faceSlots) {
        slots.push(slot);
      }
    }
  }

  return slots;
}

export function countPrintableDeckCards(cards: DetailedCardEntry[]) {
  return expandDeckForPrint(cards).length;
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

async function rasterizeImageSourceForPdf(
  source: CanvasImageSource,
  targetWidth: number,
  targetHeight: number,
  blackCorners: boolean,
): Promise<{ dataUrl: string; format: PdfImageFormat }> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: blackCorners });
  if (!ctx) throw new Error('Failed to prepare image for PDF');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (blackCorners) {
    // Preserve source alpha, then fill empty pixels inside the slot with black.
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    fillTransparentPixelsBlack(imageData.data);
    ctx.putImageData(imageData, 0, 0);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  }

  return { dataUrl: canvas.toDataURL('image/png'), format: PDF_RASTER_FORMAT };
}

async function rasterizeImageElementForPdf(
  image: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  blackCorners: boolean,
): Promise<{ dataUrl: string; format: PdfImageFormat }> {
  return rasterizeImageSourceForPdf(image, targetWidth, targetHeight, blackCorners);
}

async function rasterizeBlobForPdf(
  blob: Blob,
  targetWidth: number,
  targetHeight: number,
  blackCorners: boolean,
): Promise<{ dataUrl: string; format: PdfImageFormat }> {
  if (typeof createImageBitmap !== 'undefined') {
    const bitmap = await createImageBitmap(blob);
    try {
      return await rasterizeImageSourceForPdf(bitmap, targetWidth, targetHeight, blackCorners);
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(objectUrl);
    return rasterizeImageElementForPdf(image, targetWidth, targetHeight, blackCorners);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchImageForPdf(
  loadUrl: string,
  targetWidth: number,
  targetHeight: number,
  blackCorners: boolean,
): Promise<{ dataUrl: string; format: PdfImageFormat }> {
  const response = await fetch(loadUrl, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`);
  }

  const blob = await response.blob();
  return rasterizeBlobForPdf(blob, targetWidth, targetHeight, blackCorners);
}

async function loadImageForPdf(
  url: string,
  targetWidth: number,
  targetHeight: number,
  blackCorners: boolean,
): Promise<{ dataUrl: string; format: PdfImageFormat }> {
  const candidates = getTextureLoadUrlCandidates(url);
  if (!candidates.length) {
    throw new Error('Missing image URL');
  }

  let lastError: Error | undefined;
  for (const loadUrl of candidates) {
    try {
      return await fetchImageForPdf(loadUrl, targetWidth, targetHeight, blackCorners);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error(`Failed to load image: ${url}`);
}

function pdfImageCacheKey(imageUrl: string, blackCorners: boolean) {
  return `${imageUrl}\0bc:${blackCorners ? 1 : 0}`;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  if (!items.length) return;
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function generateDeckPdf(
  cards: DetailedCardEntry[],
  deckName: string,
  options: PrintDeckOptions,
  onProgress?: (progress: PrintDeckProgress) => void,
) {
  const slots = expandDeckForPrint(cards);
  if (!slots.length) {
    throw new Error('No cards with images to print');
  }

  const layout = estimatePrintDeckLayout(options);
  const printPixels = printImagePixelSize(layout.cardWidthMm, layout.cardHeightMm);

  if (options.addCardBacks && !options.cardBack?.imageUrl) {
    throw new Error('Select a card back to include in the PDF');
  }

  const imageCache = new Map<string, PdfRasterImage>();
  const imagesInFlight = new Map<string, Promise<PdfRasterImage>>();
  let nextImageAlias = 0;
  let loadedImageCount = 0;

  async function getPdfImage(imageUrl: string): Promise<PdfRasterImage> {
    const cacheKey = pdfImageCacheKey(imageUrl, options.blackCorners);
    const cached = imageCache.get(cacheKey);
    if (cached) return cached;

    const inFlight = imagesInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = loadImageForPdf(
      imageUrl,
      printPixels.width,
      printPixels.height,
      options.blackCorners,
    )
      .then(raster => {
        const entry: PdfRasterImage = { ...raster, alias: `p${nextImageAlias++}` };
        imageCache.set(cacheKey, entry);
        loadedImageCount++;
        onProgress?.({
          phase: 'loading',
          current: loadedImageCount,
          total: uniqueImageUrls.length,
          message: `${loadedImageCount}/${uniqueImageUrls.length} images`,
        });
        return entry;
      })
      .finally(() => {
        imagesInFlight.delete(cacheKey);
      });

    imagesInFlight.set(cacheKey, promise);
    return promise;
  }

  const uniqueImageUrls = collectUniquePrintImageUrls(
    slots,
    options.addCardBacks ? options.cardBack?.imageUrl : undefined,
  );

  onProgress?.({
    phase: 'loading',
    current: 0,
    total: uniqueImageUrls.length,
    message: `0/${uniqueImageUrls.length} images`,
  });

  await runWithConcurrency(uniqueImageUrls, PRINT_PDF_FETCH_CONCURRENCY, url =>
    getPdfImage(url),
  );

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: options.pageSize,
    compress: true,
  });

  let backImage: PdfRasterImage | undefined;
  if (options.addCardBacks && options.cardBack?.imageUrl) {
    backImage = imageCache.get(pdfImageCacheKey(options.cardBack.imageUrl, options.blackCorners));
  }

  type PagePlacement = {
    slot: (typeof slots)[number];
    col: number;
    row: number;
    x: number;
    y: number;
    image: PdfRasterImage;
  };

  const pages: PagePlacement[][] = [];

  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    const image = imageCache.get(pdfImageCacheKey(slot.imageUrl, options.blackCorners));
    if (!image) {
      throw new Error(`Missing print image for ${slot.name}`);
    }

    const pageIndex = Math.floor(index / layout.cardsPerPage);
    while (pages.length <= pageIndex) {
      pages.push([]);
    }

    const positionOnPage = index % layout.cardsPerPage;
    const col = positionOnPage % layout.cols;
    const row = Math.floor(positionOnPage / layout.cols);
    const { x, y } = printCardPositionMm(col, row, options, layout);

    pages[pageIndex].push({ slot, col, row, x, y, image });
  }

  onProgress?.({
    phase: 'rendering',
    current: pages.length,
    total: pages.length,
    message: options.addCardBacks ? 'Building pages and backs' : 'Building pages',
  });

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (pageIndex > 0) {
      doc.addPage(options.pageSize, 'portrait');
    }

    for (const placement of pages[pageIndex]) {
      doc.addImage(
        placement.image.dataUrl,
        placement.image.format,
        placement.x,
        placement.y,
        layout.cardWidthMm,
        layout.cardHeightMm,
        placement.image.alias,
        'SLOW',
      );
    }

    if (backImage) {
      doc.addPage(options.pageSize, 'portrait');
      for (const placement of pages[pageIndex]) {
        const { x, y } = mirroredPrintCardPositionMm(
          placement.col,
          placement.row,
          options,
          layout,
        );
        doc.addImage(
          backImage.dataUrl,
          backImage.format,
          x,
          y,
          layout.cardWidthMm,
          layout.cardHeightMm,
          backImage.alias,
          'SLOW',
        );
      }
    }
  }

  const safeName = deckName.trim() || 'deck';
  let blob: Blob;
  try {
    blob = doc.output('blob');
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(
        'PDF is too large to generate. Try printing fewer cards (disable sideboard/tokens or card backs).',
      );
    }
    throw error;
  }
  downloadBlob(blob, `${safeName}.pdf`);
}
