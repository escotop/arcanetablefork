import {
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from 'three';
import { Card, CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH } from './constants';
import { getLocalPlayArea } from './globals';
import {
  expandManaCostForDisplay,
  getCardManaCost,
  MANA_ICON_BY_BUCKET,
  type ManaDisplayItem,
} from './manaCost';

const LABEL_SCALE = 24;
const PIP_SIZE = 36;
const PIP_GAP = 3;
const PIP_BORDER = 2;
/** How far above the card top edge the pip row sits (world units). */
const PIP_OVERHANG = 0.55;

const manaTextureCache = new Map<string, { texture: Texture; width: number; height: number }>();
const textCanvas = document.createElement('canvas');
const loadedManaIcons = new Map<string, HTMLCanvasElement>();

function isIconBackgroundPixel(r: number, g: number, b: number, a: number) {
  if (a < 8) return true;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  // White PNG backdrop and fake-transparency checkerboard grays.
  if (r > 192 && g > 192 && b > 192 && saturation < 0.12) return true;

  return false;
}

function processIconTransparency(source: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true })!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (isIconBackgroundPixel(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])) {
      pixels[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

let manaIconsReady = false;
let manaIconsLoadPromise: Promise<void> | undefined;

function preloadManaIcons() {
  if (manaIconsLoadPromise) return manaIconsLoadPromise;

  manaIconsLoadPromise = Promise.all(
    Object.entries(MANA_ICON_BY_BUCKET).map(
      ([bucket, src]) =>
        new Promise<void>(resolve => {
          const img = new Image();
          img.onload = () => {
            loadedManaIcons.set(bucket, processIconTransparency(img));
            resolve();
          };
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  ).then(() => {
    manaIconsReady = true;
    manaTextureCache.clear();
    getLocalPlayArea()?.hand?.syncManaOverlays();
  });

  return manaIconsLoadPromise;
}

void preloadManaIcons();

function drawFilledPip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fill: string,
  label: string,
  font = 'bold 22px sans-serif',
) {
  const radius = PIP_SIZE / 2 - 1;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font;
  ctx.fillText(label, x, y + 1);
}

function drawGenericPip(ctx: CanvasRenderingContext2D, x: number, y: number, value: number) {
  drawFilledPip(
    ctx,
    x,
    y,
    '#cac5c0',
    String(value),
    value >= 10 ? 'bold 18px sans-serif' : 'bold 22px sans-serif',
  );
}

function drawVariablePip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  letter: 'X' | 'Y' | 'Z',
) {
  drawFilledPip(ctx, x, y, '#cac5c0', letter);
}

function drawSymbolPip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  item: Extract<ManaDisplayItem, { kind: 'symbol' }>,
) {
  const img = loadedManaIcons.get(item.bucket);
  const size = PIP_SIZE - 2;
  const left = x - size / 2;
  const top = y - size / 2;

  if (img) {
    ctx.drawImage(img, left, top, size, size);
    return;
  }

  const radius = PIP_SIZE / 2 - 1;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#888888';
  ctx.fill();
}

function createManaCostLabel(manaCost: string) {
  const cacheKey = `${manaCost}:${manaIconsReady ? 'icons' : 'fallback'}`;
  const cached = manaTextureCache.get(cacheKey);
  if (cached) return cached;

  const items = expandManaCostForDisplay(manaCost);
  if (!items.length) {
    return { texture: null as unknown as Texture, width: 0, height: 0 };
  }

  const ctx = textCanvas.getContext('2d', { alpha: true, willReadFrequently: true })!;
  const height = PIP_SIZE + PIP_BORDER * 2;
  const width = items.length * PIP_SIZE + Math.max(0, items.length - 1) * PIP_GAP + PIP_BORDER * 2;

  textCanvas.width = width;
  textCanvas.height = height;
  ctx.clearRect(0, 0, width, height);

  items.forEach((item, index) => {
    const x = PIP_BORDER + index * (PIP_SIZE + PIP_GAP) + PIP_SIZE / 2;
    const y = height / 2;

    if (item.kind === 'generic') {
      drawGenericPip(ctx, x, y, item.value);
    } else if (item.kind === 'variable') {
      drawVariablePip(ctx, x, y, item.letter);
    } else {
      drawSymbolPip(ctx, x, y, item);
    }
  });

  const imageData = ctx.getImageData(0, 0, textCanvas.width, textCanvas.height);
  const texture = new Texture(imageData);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = SRGBColorSpace;
  texture.premultiplyAlpha = false;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const label = {
    texture,
    width: textCanvas.width / LABEL_SCALE,
    height: textCanvas.height / LABEL_SCALE,
  };
  manaTextureCache.set(cacheKey, label);
  return label;
}

function applyOverlayLayout(card: Card, mesh: Mesh, handIndex?: number, focusedIndex?: number) {
  const label = createManaCostLabel(getCardManaCost(card.detail) ?? '');
  if (!label.texture) return;

  const material = mesh.material as MeshBasicMaterial;
  material.map = label.texture;
  material.transparent = true;
  material.depthWrite = false;
  material.alphaTest = 0.001;
  mesh.scale.set(label.width, label.height, 1);
  mesh.position.set(
    CARD_WIDTH / 2 - label.width / 2,
    CARD_HEIGHT / 2 + label.height / 2 + PIP_OVERHANG,
    CARD_THICKNESS / 2 + 0.08,
  );
  if (handIndex !== undefined) {
    syncHandManaOverlayRenderOrder(mesh, handIndex, focusedIndex);
  }
  material.needsUpdate = true;
}

/** Keep mana tags above the card fanning to their right, mirroring hand renderOrder rules. */
export function syncHandManaOverlayRenderOrder(
  overlay: Mesh,
  handIndex: number,
  focusedIndex?: number,
) {
  overlay.renderOrder = focusedIndex === handIndex ? handIndex + 1.5 : handIndex + 1.01;
}

export function updateHandManaOverlay(
  card: Card,
  handIndex?: number,
  focusedIndex?: number,
) {
  if (!card.mesh || card.mesh.userData.location !== 'hand') {
    removeHandManaOverlay(card);
    return;
  }

  const manaCost = getCardManaCost(card.detail);
  if (!manaCost || !expandManaCostForDisplay(manaCost).length) {
    removeHandManaOverlay(card);
    return;
  }

  void preloadManaIcons();

  card.modifiers = card.modifiers ?? ({} as Card['modifiers']);

  if (card.modifiers.handMana && !card.modifiers.handMana.userData.isHandManaOverlay) {
    removeHandManaOverlay(card);
  }

  if (!card.modifiers.handMana) {
    const geometry = new PlaneGeometry(1, 1);
    const mat = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      alphaTest: 0.001,
    });
    const mesh = new Mesh(geometry, mat);
    mesh.raycast = () => {};
    mesh.userData.excludeFromFocusPanel = true;
    mesh.userData.isHandManaOverlay = true;
    card.modifiers.handMana = mesh;
  }

  if (!card.mesh.children.includes(card.modifiers.handMana)) {
    card.mesh.add(card.modifiers.handMana);
  }

  applyOverlayLayout(card, card.modifiers.handMana, handIndex, focusedIndex);
}

export function removeHandManaOverlay(card: Card) {
  const mesh = card.modifiers?.handMana;
  if (!mesh) return;

  card.mesh?.remove(mesh);
  delete card.modifiers.handMana;
}

export function syncLocalHandManaOverlays(cards: Card[], focusedIndex?: number) {
  cards.forEach((card, index) => {
    updateHandManaOverlay(card, index, focusedIndex);
  });
}
