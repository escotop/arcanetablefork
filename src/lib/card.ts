import { nanoid } from 'nanoid';
import set from 'lodash-es/set';
import uniqBy from 'lodash-es/uniqBy';
import { splitProps } from 'solid-js';
import {
  BoxGeometry,
  Color,
  LinearFilter,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RGBAFormat,
  Raycaster,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector3,
  Vector3Like,
} from 'three';
import {
  Card,
  CARD_HEIGHT,
  CARD_STACK_OFFSET,
  CARD_THICKNESS,
  CARD_WIDTH,
  CardEntryDetail,
  DetailedCardEntry,
} from './constants';
import {
  buildPublicImageProxyUrl,
  getTextureLoadUrl,
  isImageProxyUrl,
  needsTextureProxy,
  normalizeTextureUrl,
} from './customCardArt';
import {
  cardBackTexture,
  cardLoadingTexture,
  cardsById,
  cardSystem,
  getProjectionVec,
  scene,
  textureLoader,
  textureLoaderWorker,
} from './globals';
import { counters } from './ui/counterDialog';
import { cancelAnimation } from './animations';
import { cleanupFromNode, isValidMaterial } from './utils';
import { serializeCardUserDataForLog } from './gameLogEvents';
import { devLog } from './devLog';
import { removeHandManaOverlay } from './handManaOverlay';
import { getCardById, getCardNamed } from './scryfall/client';

export interface CardUserData {
  cardBack?: Material;
  publicCardBack?: Material;
  resting?: Vector3Like;
}

let alphaMap: Texture;
const blackMat = new MeshStandardMaterial({ color: 0x000000 });
const NON_COUNTER_MODIFIER_MESH_KEYS = new Set(['pt', 'token', 'handMana']);

let currentSlide = 0;
let totalSlides = 6;
let xSlides = 3;
let ySlides = 2;
let ticks = 0;
let interval = 1 / 7;

export function updateTextureAnimation(delta: number) {
  ticks += delta;
  if (ticks < interval) return;
  ticks %= interval;
  if (!cardLoadingTexture) return;
  let x = (currentSlide % xSlides) / xSlides;
  let y = ((currentSlide / xSlides) | 0) / ySlides;
  cardLoadingTexture.offset.y = y;
  cardLoadingTexture.offset.x = x;
  currentSlide++;
  currentSlide = currentSlide % totalSlides;
}

export function createDeckProxyMesh() {
  const geometry = new BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
  const cardBackMat = new MeshStandardMaterial({ map: cardBackTexture });
  cardBackMat.transparent = true;

  const mesh = new Mesh(geometry, [
    blackMat.clone(),
    blackMat.clone(),
    blackMat.clone(),
    blackMat.clone(),
    blackMat.clone(),
    cardBackMat,
  ]);
  mesh.userData.isDeckProxy = true;
  mesh.userData.location = 'deck';
  mesh.userData.isInteractive = true;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

export function createDeckStackMesh() {
  const geometry = new BoxGeometry(CARD_WIDTH, CARD_HEIGHT, 1);
  const mesh = new Mesh(geometry, blackMat.clone());
  mesh.userData.isDeckStack = true;
  mesh.userData.location = 'deck';
  mesh.userData.isInteractive = true;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.visible = false;
  return mesh;
}

export function dematerializeCard(card: Card) {
  if (!card.mesh) return;
  cleanupFromNode(card.mesh);
  card.mesh.parent?.remove(card.mesh);
  card.mesh = undefined;
}

export function ensureCardMesh(card: Card, clientId: number): Card {
  if (card.mesh?.userData?.id === card.id) return card;
  if (card.mesh) {
    dematerializeCard(card);
  }
  if (!card.id) card.id = nanoid();
  card.clientId = clientId;
  initializeCardMesh(card, clientId);
  return card;
}

export function createCardGeometry(card: Card, cache?: Map<string, ImageBitmap>) {
  const geometry = new BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
  let cardBackMat = new MeshStandardMaterial({ map: cardBackTexture });
  cardBackMat.transparent = true;

  alphaMap = alphaMap ?? textureLoader.load(`/alphaMap.webp`);
  if (alphaMap.channel === undefined) alphaMap.channel = 0;
  let loadingMat = new MeshStandardMaterial({ map: cardLoadingTexture, alphaMap });
  loadingMat.transparent = true;

  let { mesh: _, modifiers, ...shared } = card;

  const mesh = new Mesh(geometry, [
    blackMat.clone(),
    blackMat.clone(),
    blackMat.clone(),
    blackMat.clone(),
    loadingMat.clone(),
    cardBackMat.clone(),
  ]);
  setCardData(mesh, 'isInteractive', true);
  setCardData(mesh, 'card', shared);
  setCardData(mesh, 'id', card.id);
  setCardData(
    mesh,
    'isDoubleSided',
    card.detail.card_faces?.length > 1 && !!card.detail.card_faces[1]?.image_uris,
  );

  mesh.userData.card_face_urls = [getCardImage(card)];

  if (mesh.userData.isDoubleSided) {
    mesh.userData.card_face_urls.push(getCardImage(card, 1));
    setCardData(mesh, 'publicCardBack', cardBackMat.clone());
    setCardData(mesh, 'cardBack', cardBackMat.clone());
  }
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function hasLoadedFrontTexture(card: Card, frontUrl: string) {
  const mesh = card.mesh;
  if (!mesh) return false;

  const normalized = normalizeTextureUrl(frontUrl);
  const currentUrl = normalizeTextureUrl(mesh.userData.card_face_urls?.[0] ?? '');
  if (normalized !== currentUrl) return false;

  const mat = mesh.material[4] as MeshStandardMaterial | undefined;
  if (!mat?.map || mat.map === cardLoadingTexture) return false;

  return true;
}

export async function loadCardTextures(
  card: Card,
  cache: Map<string, Promise<MeshStandardMaterial>> = new Map(),
) {
  if (!getCardImage(card)) {
    await ensureCardImageDetail(card);
  }

  let [front, back] = syncCardFaceUrls(card);

  if (!front) {
    devLog.warn('[loadCardTextures] missing image, using fallback for', card.detail?.name ?? card.id);
    front = getFallbackTextureUrl();
    if (card.mesh) {
      card.mesh.userData.card_face_urls = back ? [front, back] : [front];
    }
  }

  const frontLoaded = hasLoadedFrontTexture(card, front);
  const frontPromise = frontLoaded
    ? Promise.resolve()
    : loadTextureMaterial(front, cache).then(mat => {
        card.mesh.material[4] = mat.clone();
      });

  if (back) {
    const backPromise = loadTextureMaterial(back, cache);
    backPromise.then(mat => {
      card.mesh.userData.cardBack = mat.clone();
      if (card.mesh.userData.isPublic) {
        card.mesh.material[5] = card.mesh.userData.cardBack;
        card.mesh.material[5].needsUpdate = true;
      }
    });
    await backPromise;
  }

  await frontPromise;
}

const pendingImageHydration = new Map<string, Promise<void>>();

function cardImageHydrationKey(card: Card) {
  const detail = card.detail;
  if (detail?.id) return detail.id;
  return `${detail?.name ?? 'unknown'}:${detail?.set ?? ''}:${detail?.collector_number ?? ''}`;
}

async function ensureCardImageDetail(card: Card): Promise<void> {
  if (getCardImage(card)) return;
  if (!card.detail?.name) return;

  const key = cardImageHydrationKey(card);
  const pending = pendingImageHydration.get(key);
  if (pending) {
    await pending;
    return;
  }

  const job = (async () => {
    try {
      const payload = card.detail.id
        ? await getCardById(card.detail.id)
        : await getCardNamed(card.detail.name, {
            set: card.detail.set,
            id: card.detail.id,
          });
      if (!payload) return;
      card.detail = { ...card.detail, ...payload };
      card.detail.search = card.detail.search ?? getSearchLine(card.detail);
    } catch (error) {
      devLog.warn('[ensureCardImageDetail] lookup failed', card.detail?.name, error);
    } finally {
      pendingImageHydration.delete(key);
    }
  })();

  pendingImageHydration.set(key, job);
  await job;
}

const TRANSFORMS = {
  stripBraces: val => val?.replace(/[\{\}]/g, ''),
};

function buildSearchLine(cardDetail: CardEntryDetail, config) {
  let values = (config?.searchFields ?? []).flatMap(({ field, transform, recurse }) => {
    const val = cardDetail[field];
    if (recurse && Array.isArray(val)) {
      return val.map(child => buildSearchLine(child, config));
    }
    const result = transform ? TRANSFORMS[transform]?.(val) : val;
    return result ?? '';
  });

  if (config?.filterEmtpy) {
    values = values.filter(Boolean);
  }

  return values.join('\n').toLowerCase();
}

export function getSearchLine(cardDetail: CardEntryDetail) {
  return buildSearchLine(cardDetail, cardSystem.searchField);
}

export function cloneCard(card: Card, newId: string): Card {
  let { mesh, modifiers, ...shared } = card;
  let newCard = structuredClone(shared) as Card;

  newCard.id = newId;
  newCard.mesh = createCardGeometry(newCard);
  if (card.mesh) {
    const [transferable, cloneable] = splitUserdata(card.mesh.userData);
    newCard.mesh.userData = structuredClone(cloneable);
    Object.assign(newCard.mesh.userData, transferable);

    newCard.mesh.position
      .copy(card.mesh.position)
      .add(new Vector3(CARD_STACK_OFFSET, -CARD_STACK_OFFSET, CARD_THICKNESS));
    newCard.mesh.rotation.copy(card.mesh.rotation);
  }
  setCardData(newCard.mesh, 'id', newCard.id);
  updateModifiers(newCard);
  newCard.detail.search = card.detail.search ?? getSearchLine(newCard.detail);
  cardsById.set(newCard.id, newCard);
  loadCardTextures(newCard);
  return newCard;
}

const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);

export function getRotationFromCardState(userData) {
  const q = new Quaternion();

  // tap: in-plane spin about Z
  if (userData.isTapped) {
    q.setFromAxisAngle(Z_AXIS, -Math.PI / 2);
  }

  // flip: turn the card over about Y, applied in world space on top of the tap
  if (userData.isFlipped) {
    const flip = new Quaternion().setFromAxisAngle(Y_AXIS, Math.PI);
    q.multiply(flip);
  }

  return q;
}

export function applyCardOrientation(cardMesh: Object3D, zoneId?: string) {
  cancelAnimation(cardMesh);
  cardMesh.quaternion.copy(getRotationFromCardState(cardMesh.userData));
  cardMesh.rotation.setFromQuaternion(cardMesh.quaternion);
  const id = zoneId ?? cardMesh.userData.zoneId;
  if (id && cardMesh.userData.zone?.[id]) {
    setCardData(cardMesh, `zone.${id}.rotation`, cardMesh.rotation.toArray());
  }
}

export function splitUserdata(userData: CardUserData) {
  const [transferable, _, cloneable] = splitProps(
    userData,
    ['cardBack', 'publicCardBack'],
    ['resting'],
  );
  return [transferable, cloneable];
}

function getImageUris(card: { detail: CardEntryDetail }, face = 0) {
  const faceUris = card?.detail?.card_faces?.[face]?.image_uris;
  const topUris = card?.detail?.image_uris;
  if (faceUris && resolveImageUrl(faceUris)) return faceUris;
  return topUris;
}

type ImageUriSource =
  | CardEntryDetail['image_uris']
  | {
      full?: Record<string, string>;
      art?: Record<string, string>;
      large?: string;
      normal?: string;
      art_crop?: string;
    };

export function resolveImageUrl(
  uris: ImageUriSource | undefined,
  format: 'standard' | 'scryfall' = cardSystem.imageUriFormat,
) {
  if (!uris) return undefined;

  const direct = uris.large ?? uris.normal;
  if (format === 'scryfall' && direct) return direct;

  const full = Object.values(uris.full ?? {});
  if (full.length > 0) return full[0];

  const art = Object.values(uris.art ?? {});
  if (art.length > 0) return art[0];

  return direct;
}

export function getCardImage(card: DetailedCardEntry | Card, face = 0) {
  if (face === 0 && card.customArtUrl) {
    return normalizeTextureUrl(card.customArtUrl);
  }
  return normalizeTextureUrl(resolveImageUrl(getImageUris(card, face)));
}

function getNearestPowerOfTwo(value: number) {
  return 2 ** Math.round(Math.log2(value));
}

function shouldLoadTextureOnMainThread(url: string) {
  if (isImageProxyUrl(url)) return true;

  try {
    const parsed = new URL(url, globalThis.location?.origin ?? 'http://localhost');
    const systemHost = cardSystem.uri ? new URL(cardSystem.uri).host : '';
    if (parsed.host === systemHost) return false;
    if (globalThis.location?.origin && parsed.origin === globalThis.location.origin) return false;
    return true;
  } catch {
    return true;
  }
}

async function decodeTextureBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'flipY' });
  } catch {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return bitmap;

    ctx.translate(0, bitmap.height);
    ctx.scale(1, -1);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return createImageBitmap(canvas);
  }
}

function resizeTextureBitmap(bitmap: ImageBitmap) {
  const width = getNearestPowerOfTwo(bitmap.width);
  const height = getNearestPowerOfTwo(bitmap.height);
  if (width === bitmap.width && height === bitmap.height) {
    return bitmap;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return bitmap;

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return createImageBitmap(canvas);
}

async function loadTextureBitmapViaImage(url: string): Promise<ImageBitmap> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });

  const width = getNearestPowerOfTwo(image.naturalWidth || image.width);
  const height = getNearestPowerOfTwo(image.naturalHeight || image.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.translate(0, height);
  ctx.scale(1, -1);
  ctx.drawImage(image, 0, 0, width, height);
  return createImageBitmap(canvas);
}

async function loadTextureBitmapMainThread(url: string): Promise<ImageBitmap> {
  if (isImageProxyUrl(url)) {
    return loadTextureBitmapViaImage(url);
  }

  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Failed to fetch texture: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Unexpected content type: ${contentType}`);
  }

  const blob = await response.blob();
  const bitmap = await decodeTextureBlob(blob);
  return resizeTextureBitmap(bitmap);
}

async function loadTextureBitmapWithUrl(loadUrl: string): Promise<ImageBitmap> {
  if (shouldLoadTextureOnMainThread(loadUrl)) {
    return loadTextureBitmapMainThread(loadUrl);
  }

  return textureLoaderWorker.loadTexture(loadUrl);
}

async function loadTextureBitmap(url: string): Promise<ImageBitmap> {
  const normalized = normalizeTextureUrl(url);
  if (!normalized) throw new Error('texture url not found');

  const loadUrl = getTextureLoadUrl(normalized) ?? normalized;

  try {
    return await loadTextureBitmapWithUrl(loadUrl);
  } catch (error) {
    if (!needsTextureProxy(normalized)) throw error;

    const fallbackUrl = buildPublicImageProxyUrl(normalized);
    if (!fallbackUrl || fallbackUrl === loadUrl) throw error;

    return loadTextureBitmapWithUrl(fallbackUrl);
  }
}

function createCardTextureMaterial(image: ImageBitmap) {
  const map = new Texture(image);
  map.colorSpace = SRGBColorSpace;
  map.format = RGBAFormat;
  map.type = UnsignedByteType;
  map.channel = 0;
  map.needsUpdate = true;

  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    map,
    alphaMap,
  });
  mat.transparent = true;
  mat.needsUpdate = true;
  return mat;
}

export function createCardFrontMaterial(image: ImageBitmap) {
  alphaMap = alphaMap ?? textureLoader.load(`/alphaMap.webp`);
  if (alphaMap.channel === undefined) alphaMap.channel = 0;
  return createCardTextureMaterial(image);
}

function getFallbackTextureUrl() {
  return normalizeTextureUrl(cardSystem.fallbackImage ?? '/unknown-card-image.webp');
}

async function loadTextureMaterial(
  url: string,
  cache: Map<string, Promise<MeshStandardMaterial>>,
): Promise<MeshStandardMaterial> {
  const normalized = normalizeTextureUrl(url);
  if (!normalized) throw new Error('texture url not found');

  if (!cache.has(normalized)) {
    cache.set(
      normalized,
      loadTextureBitmap(normalized)
        .then(image => createCardTextureMaterial(image))
        .catch(async error => {
          const loadUrl = getTextureLoadUrl(normalized) ?? normalized;
          devLog.warn('Failed to load card texture, using fallback:', normalized, 'loadUrl:', loadUrl, error);
          const fallback = getFallbackTextureUrl();
          if (!fallback || fallback === normalized) {
            throw error;
          }
          const image = await loadTextureBitmap(fallback);
          return createCardTextureMaterial(image);
        }),
    );
  }

  return cache.get(normalized)!;
}

function syncCardFaceUrls(card: Card): [string, string | undefined] {
  const front =
    normalizeTextureUrl(card.customArtUrl ?? getCardImage(card) ?? card.mesh?.userData.card_face_urls?.[0]) ??
    '';
  const back = card.mesh?.userData.isDoubleSided
    ? normalizeTextureUrl(getCardImage(card, 1) ?? card.mesh?.userData.card_face_urls?.[1])
    : undefined;

  if (card.mesh) {
    card.mesh.userData.card_face_urls = back ? [front, back] : [front];
  }

  return [front, back];
}

export function getCardArtImage(card: { detail: CardEntryDetail }) {
  const uris = getImageUris(card);
  if (cardSystem.imageUriFormat === 'scryfall') {
    return uris?.art_crop;
  }
  const art = Object.values(uris?.art ?? {});
  return art[0];
}

export function initializeCardMesh(card: Card, clientId: string | number): Card {
  if (!card.id) card.id = nanoid();
  const mesh = createCardGeometry(card);
  setCardData(mesh, 'clientId', clientId);
  card.mesh = mesh;
  card.clientId = Number(clientId);
  cardsById.set(card.id, card);
  return card;
}

export function getCardMeshTetherPoint(cardMesh: Mesh) {
  let offset = { x: 0, y: 0 };
  let targetVertex = 6;
  if (cardMesh.userData.isTapped) {
    targetVertex = 15;
  }

  let location = cardMesh.userData.location;

  if (location === 'hand') {
    offset.y = '-50%';
  }

  if (['deck'].includes(location)) {
    if (cardMesh.userData.isPublic) {
      targetVertex = 8;
    } else {
      targetVertex = 1;
    }
  }

  if (location === 'deck') {
    offset.y = '-100%';
  }

  if (['battlefield'].includes(location)) {
    if (cardMesh.userData.isFlipped) {
      if (cardMesh.userData.isTapped) {
        targetVertex = 6;
      } else {
        targetVertex = 2;
      }
    } else {
      if (cardMesh.userData.isTapped) {
        targetVertex = 15;
      } else {
        targetVertex = 6;
      }
    }
  }

  let vec = new Vector3().fromArray(
    cardMesh.geometry.attributes.position.array.slice(targetVertex * 3),
  );
  cardMesh.localToWorld(vec);
  const tether = getProjectionVec(vec);
  if (!tether) return { x: 0, y: 0, offset };
  tether.offset = offset;
  return tether;
}

export function cleanupCard(card: Card) {
  removeHandManaOverlay(card);
  if (!card.mesh) {
    cardsById.delete(card.id);
    return;
  }
  cleanupFromNode(card.mesh);
  cardsById.delete(card.id);
}

export function setCardData<Field extends keyof CardUserData>(
  cardMesh: Object3D,
  field: Field,
  value: CardUserData[Field],
) {
  let modifiersNeedUpdate = false;
  // before setting value
  if (field === 'isPublic') {
    if (cardMesh.userData.isDoubleSided) {
      let material = cardMesh.userData[value ? 'cardBack' : 'publicCardBack'];

      if (!isValidMaterial(material)) {
        devLog.warn(`Invalid material assigned to mesh!`, {
          material,
          cardMesh,
        });
        console.trace(`Material Assignment Trace`);
      }

      cardMesh.material[cardMesh.material.length - 1] = material;
    }
    if (!value) {
      setCardData(cardMesh, 'isFlipped', false);
    }
  }
  if (
    field === 'location' &&
    cardMesh.userData.previousValue === 'battlefield' &&
    value !== 'battlefield'
  ) {
    cleanupFromNode(cardMesh);
    cardMesh.userData.isFlipped = false;
    cardMesh.userData.modifiers = undefined;
    cardMesh.userData.isTapped = false;
  }

  if (field === 'location') {
    if (cardMesh.userData.location === 'hand' && value !== 'hand') {
      const card = cardsById.get(cardMesh.userData.id);
      if (card) removeHandManaOverlay(card);
    }
    cardMesh.userData.previousLocation = cardMesh.userData.location;
  }

  if (field === 'isPublic') {
    cardMesh.userData.wasPublic = cardMesh.userData.isPublic;
  }

  if (field === `zoneId`) {
    cardMesh.userData.previousZoneId = cardMesh.userData.zoneId;
  }

  if (field === 'isToken' && cardMesh.userData.isToken !== value) {
    modifiersNeedUpdate = true;
  }

  set(cardMesh.userData, field, value);

  // after setting value

  if (field === 'isFlipped') {
    modifiersNeedUpdate = true;
  }

  if (modifiersNeedUpdate) {
    let card = cardsById.get(cardMesh.userData.id);
    if (card) updateModifiers(card);
  }
}

const textCanvas = document.createElement('canvas');

const LABEL_SCALE = 24;
const LABEL_STYLES = {
  counter: {
    font: '56px grobold',
    paddingX: 24,
    paddingY: 12,
    borderRadius: 18,
    textHeight: 56,
  },
  default: {
    font: '42px grobold',
    paddingX: 18,
    paddingY: 8,
    borderRadius: 14,
    textHeight: 42,
  },
} as const;

let expandedCounterLabelsCardId: string | null = null;
const counterLabelTextureCache = new Map<
  string,
  {
    valueKey: string;
    compact: { texture: Texture; width: number; height: number };
    expanded: { texture: Texture; width: number; height: number };
  }
>();

function getCounterLabelTextures(
  cardId: string,
  counterId: string,
  value: number | string | boolean,
  name: string,
) {
  const cacheKey = `${cardId}:${counterId}`;
  const valueKey = `${value}|${name}`;
  let cache = counterLabelTextureCache.get(cacheKey);
  if (!cache || cache.valueKey !== valueKey) {
    cache = {
      valueKey,
      compact: createLabel(getCounterLabel(value, name, false), true),
      expanded: createLabel(getCounterLabel(value, name, true), true),
    };
    counterLabelTextureCache.set(cacheKey, cache);
  }
  return cache;
}

export function setCounterLabelHoverTarget(cardId: string | null) {
  if (expandedCounterLabelsCardId === cardId) return;

  if (expandedCounterLabelsCardId) {
    const prev = cardsById.get(expandedCounterLabelsCardId);
    if (prev?.mesh) updateCounterLayouts(prev, false);
    expandedCounterLabelsCardId = null;
  }

  if (!cardId) return;

  const card = cardsById.get(cardId);
  if (!card?.mesh) return;

  expandedCounterLabelsCardId = cardId;
  updateCounterLayouts(card, true);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function createLabel(text: string, badge = false) {
  const ctx = textCanvas.getContext('2d', { willReadFrequently: true })!;
  const style = badge ? LABEL_STYLES.counter : LABEL_STYLES.default;
  const font = style.font;
  const paddingX = style.paddingX;
  const paddingY = style.paddingY;
  const borderRadius = style.borderRadius;
  const textHeight = style.textHeight;
  const borderWidth = 2;

  ctx.font = font;
  const textWidth = ctx.measureText(text).width;

  const innerW = textWidth + paddingX * 2;
  const innerH = textHeight + paddingY * 2;
  textCanvas.width = Math.ceil(innerW + borderWidth * 2);
  textCanvas.height = Math.ceil(innerH + borderWidth * 2);

  const x = borderWidth / 2;
  const y = borderWidth / 2;
  const w = textCanvas.width - borderWidth;
  const h = textCanvas.height - borderWidth;

  if (badge) {
    drawRoundedRect(ctx, x, y, w, h, borderRadius);
    ctx.fillStyle = '#000000';
    ctx.fill();
    drawRoundedRect(ctx, x, y, w, h, borderRadius);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = borderWidth;
    ctx.stroke();
  }

  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, textCanvas.width / 2, textCanvas.height / 2);

  const texture = new Texture(ctx.getImageData(0, 0, textCanvas.width, textCanvas.height));
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const scale = badge ? LABEL_SCALE : 31;
  return {
    texture,
    width: textCanvas.width / scale,
    height: textCanvas.height / scale,
  };
}

function getCounterLabel(
  value: number | string | boolean,
  name: string,
  showName: boolean,
) {
  if (!showName) {
    switch (typeof value) {
      case 'number':
        return value.toLocaleString();
      case 'boolean':
        return value ? '1' : '';
      default:
        return value.toString();
    }
  }

  switch (typeof value) {
    case 'number':
      return `${value.toLocaleString()} ${name}`;
    case 'boolean':
      return value ? `is ${name}` : ``;
    default:
      return `${value} ${name}`;
  }
}

function applyCounterLayout(
  card: Card,
  counter: { id: string; name: string; color: string },
  value: number | string | boolean,
  index: number,
  expanded: boolean,
) {
  const mesh = card.modifiers[counter.id] as Mesh | undefined;
  if (!mesh || !card.mesh) return;

  const labels = getCounterLabelTextures(card.id, counter.id, value, counter.name);
  const label = expanded || counter.id === 'token' ? labels.expanded : labels.compact;

  mesh.material[4].map = label.texture;
  mesh.material[5].map = label.texture;
  mesh.scale.set(label.width, label.height, CARD_THICKNESS + 0.1);

  mesh.position.set(
    (CARD_WIDTH / 2 + label.width / 2) * (card.mesh.userData.isFlipped ? -1 : 1),
    CARD_HEIGHT / 2 - index * (label.height + 0.25) - 2.5,
    CARD_THICKNESS / 2 + 0.05,
  );
  mesh.material[4].needsUpdate = true;
  mesh.material[5].needsUpdate = true;
}

function updateCounterLayouts(card: Card, expanded: boolean) {
  if (!card.mesh) return;

  const countersById = Object.fromEntries(counters().map(counter => [counter.id, counter]));
  const modifierCounters = new Set([
    ...Object.keys(card.mesh.userData.modifiers?.counters ?? {}),
    ...Object.keys(card.modifiers),
  ]);
  modifierCounters.delete('pt');
  modifierCounters.delete('token');
  NON_COUNTER_MODIFIER_MESH_KEYS.forEach(key => modifierCounters.delete(key));

  const modifiers = Array.from(modifierCounters)
    .map(counterId => ({
      counter: countersById[counterId],
      value: card.mesh.userData.modifiers?.counters[counterId],
    }))
    .filter(modifier => modifier.counter && modifier.value)
    .sort((a, b) => {
      if (a.value === b.value) return a.counter.name.localeCompare(b.counter.name);
      return b.value - a.value;
    });

  modifiers.forEach((modifier, index) => {
    applyCounterLayout(card, modifier.counter, modifier.value, index, expanded);
  });
}

function updateCounter(
  card: Card,
  counter: { id: string; name: string; color: string } | undefined,
  value: number | string | boolean,
  index: number,
) {
  if (!counter?.id || !card.mesh) return;
  if (!card.modifiers[counter.id]) {
    let geometry = new BoxGeometry(1, 1, 1);
    let mat = new MeshStandardMaterial({ color: 0xffffff });
    let mesh = new Mesh(geometry, [blackMat, blackMat, blackMat, blackMat, mat, mat]);
    mesh.scale.set(1, 3, CARD_THICKNESS + 0.1);
    card.mesh.add(mesh);
    mesh.transparent = true;
    card.modifiers[counter.id] = mesh;
  }
  if (value) {
    if (!card.mesh.children.includes(card.modifiers[counter.id])) {
      card.mesh.add(card.modifiers[counter.id]);
    }
    const expanded = card.id === expandedCounterLabelsCardId;
    applyCounterLayout(card, counter, value, index, expanded);
  } else {
    card.mesh.remove(card.modifiers[counter.id]);
  }
}

export function updateModifiers(card: Card) {
  card.modifiers = card.modifiers ?? {};

  let { power = 0, toughness = 0 } = card.mesh.userData.modifiers || {};

  if (power !== 0 || toughness !== 0) {
    if (!card.modifiers.pt) {
      let geometry = new BoxGeometry(1, 1, 1);
      let mat = new MeshStandardMaterial({ color: 0xffffff });
      let mesh = new Mesh(geometry, [blackMat, blackMat, blackMat, blackMat, mat, mat]);
      mesh.scale.set(7, 3, CARD_THICKNESS + 0.1);
      card.mesh.add(mesh);
      mesh.transparent = true;
      mesh.position.set(CARD_WIDTH / 2, -CARD_HEIGHT / 2 - 0.25, CARD_THICKNESS / 2 + 0.05);
      card.modifiers.pt = mesh;
    }
    let mesh = card.modifiers.pt as Mesh;
    if (!card.mesh.children.includes(mesh)) {
      card.mesh.add(mesh);
    }
    let label = createLabel(
      `${power > 0 ? '+' : ''}${power} / ${toughness > 0 ? '+' : ''}${toughness}`,
      true,
    );
    mesh.material[4].map = label.texture;
    mesh.material[5].map = label.texture;
    mesh.scale.set(label.width, label.height, CARD_THICKNESS + 0.1);
    const xPosition = (CARD_WIDTH / 2 - label.width / 2) * (card.mesh.userData.isFlipped ? -1 : 1);
    mesh.position.set(
      xPosition,
      -CARD_HEIGHT / 2 - 0.25,
      CARD_THICKNESS / 2 + 0.05,
    );
    mesh.material[4].needsUpdate = true;
    mesh.material[5].needsUpdate = true;
  } else if (card.modifiers.pt) {
    card.mesh.remove(card.modifiers.pt);
  }

  const countersById = Object.fromEntries(counters().map(counter => [counter.id, counter]));

  let modifierCounters = new Set([
    ...Object.keys(card.mesh.userData.modifiers?.counters ?? {}),
    ...Object.keys(card.modifiers),
  ]);
  modifierCounters.delete('pt');
  modifierCounters.delete('token');
  NON_COUNTER_MODIFIER_MESH_KEYS.forEach(key => modifierCounters.delete(key));

  const modifiers = Array.from(modifierCounters)
    .map(counterId => {
      return {
        counter: countersById[counterId],
        value: card.mesh.userData.modifiers?.counters[counterId],
      };
    })
    .filter(modifier => modifier.counter);

  if (card.mesh.userData.isToken) {
    modifiers.push({ counter: { name: 'token', id: 'token' }, value: card.mesh.userData.isToken });
  }

  if (!modifiers.length) return;

  modifiers
    .sort((a, b) => {
      if (a.value === b.value) return a.counter.name.localeCompare(b.counter.name);
      return b.value - a.value;
    })
    .forEach((modifier, index) => {
      updateCounter(card, modifier.counter, modifier.value, index);
    });
}

export function getSerializableCard(cardMesh: Object3D) {
  return {
    detail: cardMesh.userData.card.detail,
    id: cardMesh.userData.id,
    userData: serializeCardUserDataForLog(cardMesh.userData),
    position: cardMesh.position.toArray(),
    rotation: cardMesh.rotation.toArray(),
  };
}
