import { getCardImage } from './card';
import { getTextureLoadUrl } from './customCardArt';
import { DetailedCardEntry } from './constants';

export const MTG_CARD_WIDTH_MM = 63;
export const MTG_CARD_HEIGHT_MM = 88;

export type PrintPageSize = 'a4' | 'letter';

export interface PrintDeckOptions {
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

export interface PrintDeckProgress {
  phase: 'loading' | 'rendering';
  current: number;
  total: number;
  message?: string;
}

const PAGE_SIZES: Record<PrintPageSize, [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};

type PdfImageFormat = 'PNG' | 'JPEG';

export function getDefaultPrintDeckOptions(): PrintDeckOptions {
  return {
    spacingMm: 0.2,
    scale: 1,
    pageMarginMm: 5,
    pageSize: 'a4',
  };
}

export function estimatePrintDeckLayout(options: PrintDeckOptions): PrintDeckLayout {
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

export function expandDeckForPrint(cards: DetailedCardEntry[]) {
  const slots: { name: string; imageUrl: string }[] = [];

  for (const card of cards) {
    const imageUrl = getCardImage(card);
    if (!imageUrl || !card.qty) continue;

    for (let copy = 0; copy < card.qty; copy++) {
      slots.push({ name: card.name, imageUrl });
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

async function loadImageForPdf(url: string): Promise<{ dataUrl: string; format: PdfImageFormat }> {
  const loadUrl = getTextureLoadUrl(url) ?? url;
  const response = await fetch(loadUrl, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`);
  }

  const blob = await response.blob();
  const mime = blob.type.toLowerCase();

  if (mime.includes('png')) {
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, format: 'PNG' };
  }

  if (mime.includes('jpeg') || mime.includes('jpg')) {
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, format: 'JPEG' };
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to prepare image for PDF');
    ctx.drawImage(image, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), format: 'PNG' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: options.pageSize,
  });

  const imageCache = new Map<string, { dataUrl: string; format: PdfImageFormat }>();

  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    onProgress?.({
      phase: index === slots.length - 1 ? 'rendering' : 'loading',
      current: index + 1,
      total: slots.length,
      message: slot.name,
    });

    let image = imageCache.get(slot.imageUrl);
    if (!image) {
      image = await loadImageForPdf(slot.imageUrl);
      imageCache.set(slot.imageUrl, image);
    }

    if (index > 0 && index % layout.cardsPerPage === 0) {
      doc.addPage(options.pageSize, 'portrait');
    }

    const positionOnPage = index % layout.cardsPerPage;
    const col = positionOnPage % layout.cols;
    const row = Math.floor(positionOnPage / layout.cols);
    const x = options.pageMarginMm + col * (layout.cardWidthMm + options.spacingMm);
    const y = options.pageMarginMm + row * (layout.cardHeightMm + options.spacingMm);

    doc.addImage(image.dataUrl, image.format, x, y, layout.cardWidthMm, layout.cardHeightMm);
  }

  const safeName = deckName.trim() || 'deck';
  const blob = doc.output('blob');
  downloadBlob(blob, `${safeName}.pdf`);
}
