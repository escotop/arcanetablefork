import { nanoid } from 'nanoid';
import set from 'lodash-es/set';
import uniqBy from 'lodash-es/uniqBy';
import { splitProps, untrack } from 'solid-js';
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
  boxGeometry,
  cardBackTexture,
  cardLoadingTexture,
  cardsById,
  cardSystem,
  getLocalPlayArea,
  getLocalPlayerClientId,
  getProjectionVec,
  isEventCatchUpComplete,
  playAreas,
  scene,
  textureLoader,
  textureLoaderWorker,
} from './globals';
import { counters } from './ui/counterDialog';
import { shouldRenderLoyaltyCounterOnCard, syncLoyaltyCounterForCard } from './loyaltyCounter';
import { cancelAnimation } from './animations';
import { cleanupFromNode, isValidMaterial } from './utils';
import { serializeCardUserDataForLog, slimCardDetailForLog } from './gameLogEvents';
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
const COUNTER_LABEL_FONT = '56px grobold';
const COUNTER_LABEL_EMPHASIS_FONT = '68px grobold';

export interface CounterLabelHit {
  mesh: Mesh;
  cardId: string;
  counterId: string;
}

export type PtCounterSide = 'power' | 'toughness';

export type CardModifiers = {
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
};

export function normalizeCardCounterModifiers(
  prev: CardModifiers,
  next: CardModifiers | undefined | null,
): CardModifiers {
  const prevCounters = { ...(prev.counters ?? {}) };

  if (!next || typeof next !== 'object') {
    return {
      power: prev.power ?? 0,
      toughness: prev.toughness ?? 0,
      counters: sanitizeCardCounterValues(prevCounters),
    };
  }

  const incomingCounters =
    next.counters && typeof next.counters === 'object' && !Array.isArray(next.counters)
      ? next.counters
      : {};

  return {
    power:
      typeof next.power === 'number' && !Number.isNaN(next.power)
        ? next.power
        : (prev.power ?? 0),
    toughness:
      typeof next.toughness === 'number' && !Number.isNaN(next.toughness)
        ? next.toughness
        : (prev.toughness ?? 0),
    counters: sanitizeCardCounterValues({ ...prevCounters, ...incomingCounters }),
  };
}

export function sanitizeCardCounterValues(
  counters: Record<string, unknown>,
): Record<string, number> {
  const sanitized: Record<string, number> = {};

  for (const [id, value] of Object.entries(counters)) {
    if (value === null || value === undefined) continue;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isNaN(parsed)) sanitized[id] = parsed;
  }

  return sanitized;
}

export function refreshAllCardCounterLabels() {
  cardsById.forEach(card => {
    if (card.mesh?.userData.modifiers?.counters) {
      updateModifiers(card);
    }
  });
}

type LabelEmphasis = false | 'all' | 'left' | 'right';

interface CounterLabelHoverState {
  cardId: string;
  counterId: string;
  ptSide?: PtCounterSide;
}

let hoveredCounterLabel: CounterLabelHoverState | null = null;

function tagCounterLabelMesh(mesh: Mesh, card: Card, counterId: string) {
  mesh.userData.isCounterLabel = true;
  mesh.userData.counterId = counterId;
  mesh.userData.cardId = card.id;
  mesh.userData.clientId = card.mesh?.userData.clientId;
}

function cleanupCounterModifierMeshes(cardMesh: Object3D) {
  const card = cardsById.get(cardMesh.userData.id);
  if (!card?.mesh) return;
  for (const [counterId, mesh] of Object.entries(card.modifiers)) {
    if (NON_COUNTER_MODIFIER_MESH_KEYS.has(counterId)) continue;
    card.mesh.remove(mesh as Mesh);
    delete card.modifiers[counterId];
  }
}

function getLabelEmphasis(cardId: string, counterId: string): LabelEmphasis {
  if (!hoveredCounterLabel) return false;
  if (
    hoveredCounterLabel.cardId !== cardId ||
    hoveredCounterLabel.counterId !== counterId
  ) {
    return false;
  }
  if (counterId === 'pt') {
    if (hoveredCounterLabel.ptSide === 'power') return 'left';
    if (hoveredCounterLabel.ptSide === 'toughness') return 'right';
    return false;
  }
  return 'all';
}

function applyCounterLabelAppearance(
  mesh: Mesh,
  cardId: string,
  counterId: string,
  labelText: string,
) {
  const emphasis = getLabelEmphasis(cardId, counterId);
  const label = createLabel(labelText, true, emphasis);
  mesh.material[4].map = label.texture;
  mesh.material[5].map = label.texture;
  mesh.scale.set(label.width, label.height, CARD_THICKNESS + 0.1);
  mesh.material[4].needsUpdate = true;
  mesh.material[5].needsUpdate = true;
}

export function resolveCounterLabelHit(object: Object3D | undefined): CounterLabelHit | undefined {
  let current: Object3D | null | undefined = object;
  while (current) {
    const { isCounterLabel, counterId, cardId } = current.userData ?? {};
    if (isCounterLabel && counterId && cardId && counterId !== 'token') {
      return {
        mesh: current as Mesh,
        cardId,
        counterId,
      };
    }
    current = current.parent;
  }
}

export function findCounterLabelIntersection(
  intersects: { object: Object3D; point: Vector3 }[],
) {
  for (const hit of intersects) {
    const counterHit = resolveCounterLabelHit(hit.object);
    if (counterHit && canAdjustCounterLabelHit(counterHit)) {
      return { counterHit, point: hit.point };
    }
  }
}

export function resolvePtCounterSide(mesh: Mesh, worldPoint: Vector3): PtCounterSide {
  const localPoint = worldPoint.clone();
  mesh.updateWorldMatrix(true, false);
  mesh.worldToLocal(localPoint);
  return localPoint.x < 0 ? 'power' : 'toughness';
}

export function canAdjustCounterLabelHit(hit: CounterLabelHit) {
  const card = cardsById.get(hit.cardId);
  const area = getLocalPlayArea();
  if (!card?.mesh || !area?.isLocalPlayArea) return false;
  if (card.mesh.userData.location !== 'battlefield') return false;
  if (card.mesh.userData.clientId !== getLocalPlayerClientId()) return false;
  return true;
}

export function setCounterLabelPointerHover(
  cardId: string | null,
  counterId: string | null,
  ptSide?: PtCounterSide | null,
) {
  const next: CounterLabelHoverState | null =
    cardId && counterId
      ? {
          cardId,
          counterId,
          ptSide: counterId === 'pt' ? ptSide ?? undefined : undefined,
        }
      : null;
  if (
    hoveredCounterLabel?.cardId === next?.cardId &&
    hoveredCounterLabel?.counterId === next?.counterId &&
    hoveredCounterLabel?.ptSide === next?.ptSide
  ) {
    return;
  }

  const cardsToRefresh = new Set<string>();
  if (hoveredCounterLabel) cardsToRefresh.add(hoveredCounterLabel.cardId);
  if (next) cardsToRefresh.add(next.cardId);
  hoveredCounterLabel = next;

  cardsToRefresh.forEach(id => {
    const card = cardsById.get(id);
    if (card) updateModifiers(card);
  });
}

export function adjustCounterLabelHit(
  hit: CounterLabelHit,
  delta: number,
  ptSide?: PtCounterSide,
) {
  if (!canAdjustCounterLabelHit(hit)) return;

  const card = cardsById.get(hit.cardId);
  const area = getLocalPlayArea();
  if (!card || !area) return;

  if (hit.counterId === 'pt') {
    const side = ptSide ?? 'power';
    area.modifyCard(card, modifiers => ({
      ...modifiers,
      [side]: (modifiers[side] ?? 0) + delta,
    }));
    return;
  }

  area.modifyCard(card, modifiers => {
    const previous = modifiers.counters?.[hit.counterId];
    const nextValue = (previous ?? 0) + delta;
    return {
      ...modifiers,
      counters: {
        ...modifiers.counters,
        [hit.counterId]: previous === undefined ? Math.max(1, nextValue) : nextValue,
      },
    };
  });
}

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

export function ensureDoubleSidedCardMaterials(mesh: Mesh) {
  if (!mesh.userData.isDoubleSided) return;

  if (!isValidMaterial(mesh.userData.publicCardBack)) {
    const publicBack = new MeshStandardMaterial({ map: cardBackTexture });
    publicBack.transparent = true;
    mesh.userData.publicCardBack = publicBack;
  }

  if (!isValidMaterial(mesh.userData.cardBack)) {
    mesh.userData.cardBack = (mesh.userData.publicCardBack as MeshStandardMaterial).clone();
  }
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
  cache: Map<string, Promise<MeshStandardMaterial>> = cardTextureMaterialCache,
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

function findCardByMesh(mesh: Mesh): Card | undefined {
  return untrack(() => {
    for (const area of Object.values(playAreas)) {
      if (!area) continue;
      const zones = [
        area.battlefieldZone,
        area.hand,
        area.graveyardZone,
        area.exileZone,
        area.deck,
        area.peekZone,
        area.revealZone,
        area.tokenSearchZone,
      ];
      for (const zone of zones) {
        const match = zone.cards?.find(card => card.mesh === mesh);
        if (match) return match;
      }
    }
    return undefined;
  });
}

function resolveCardForMesh(mesh: Mesh | undefined): Card | undefined {
  if (!mesh?.userData?.id) return undefined;

  return untrack(() => {
    // Durante el replay, solo usar cardsById (no buscar por mesh para evitar bucles)
    if (!isEventCatchUpComplete()) {
      return cardsById.get(mesh.userData.id);
    }

    const byMesh = findCardByMesh(mesh);
    if (byMesh) {
      if (cardsById.get(byMesh.id) !== byMesh) {
        cardsById.set(byMesh.id, byMesh);
      }
      return byMesh;
    }

    return cardsById.get(mesh.userData.id);
  });
}

export function resolveInteractiveCard(object?: Object3D | null): Card | undefined {
  return untrack(() => {
    if (!object) return undefined;

    const mesh = object as Mesh;
    const resolved = resolveCardForMesh(mesh);
    if (resolved) return resolved;

    const parent = object.parent as Mesh | undefined;
    if (parent?.userData?.id) {
      return resolveCardForMesh(parent);
    }

    return undefined;
  });
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
  if (newCard.clientId != null && newCard.mesh.userData.clientId == null) {
    setCardData(newCard.mesh, 'clientId', newCard.clientId);
  }
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

const cardTextureMaterialCache = new Map<string, Promise<MeshStandardMaterial>>();

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

const localHandFlippedCards = new Set<string>();

export function isLocalHandFlipped(cardId: string) {
  return localHandFlippedCards.has(cardId);
}

export async function applyHandCardFace(card: Card, faceIndex: 0 | 1) {
  if (!card.mesh) return;

  await loadCardTextures(card);
  const url = normalizeTextureUrl(
    getCardImage(card, faceIndex) ?? card.mesh.userData.card_face_urls?.[faceIndex],
  );
  if (!url) return;

  const mat = await loadTextureMaterial(url, cardTextureMaterialCache);
  card.mesh.material[4] = mat.clone();
  card.mesh.material[4].needsUpdate = true;
}

export function clearLocalHandFlip(cardId: string) {
  if (!localHandFlippedCards.delete(cardId)) return;
  const card = cardsById.get(cardId);
  if (card?.mesh?.userData.location === 'hand') {
    void applyHandCardFace(card, 0);
  }
}

export async function toggleLocalHandFlip(card: Card) {
  if (!card.mesh?.userData.isDoubleSided) return;
  if (card.mesh.userData.location !== 'hand') return;

  const showBackFace = !localHandFlippedCards.has(card.id);
  if (showBackFace) {
    localHandFlippedCards.add(card.id);
  } else {
    localHandFlippedCards.delete(card.id);
  }

  await applyHandCardFace(card, showBackFace ? 1 : 0);
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
        ensureDoubleSidedCardMaterials(cardMesh as Mesh);
        material = cardMesh.userData[value ? 'cardBack' : 'publicCardBack'];
      }

      if (isValidMaterial(material)) {
        (cardMesh.material as Material[])[(cardMesh.material as Material[]).length - 1] = material;
      } else {
        devLog.warn('[setCardData] skipping isPublic face — no valid card back material', {
          cardId: cardMesh.userData.id,
          isPublic: value,
        });
      }
    }
    if (!value) {
      setCardData(cardMesh, 'isFlipped', false);
    }
  }
  if (field === 'location') {
    if (cardMesh.userData.location === 'hand' && value !== 'hand') {
      const card = cardsById.get(cardMesh.userData.id);
      if (card) removeHandManaOverlay(card);
      clearLocalHandFlip(cardMesh.userData.id);
    }
    if (cardMesh.userData.location === 'battlefield' && value !== 'battlefield') {
      cleanupCounterModifierMeshes(cardMesh);
      cardMesh.userData.isFlipped = false;
      cardMesh.userData.modifiers = undefined;
      cardMesh.userData.isTapped = false;
    }
    cardMesh.userData.previousLocation = cardMesh.userData.location;
    modifiersNeedUpdate = true;
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
    if (cardMesh.userData.location === 'battlefield') {
      const card = cardsById.get(cardMesh.userData.id);
      if (card) void syncLoyaltyCounterForCard(card);
    }
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

export function createLabel(text: string, badge = false, emphasis: LabelEmphasis = false) {
  const ctx = textCanvas.getContext('2d', { willReadFrequently: true })!;
  const style = badge ? LABEL_STYLES.counter : LABEL_STYLES.default;
  const paddingX = style.paddingX;
  const paddingY = style.paddingY;
  const borderRadius = style.borderRadius;
  const textHeight = style.textHeight;
  const borderWidth = 2;

  const measureWithEmphasis = (segment: string, segmentEmphasis: boolean) => {
    ctx.font = segmentEmphasis ? COUNTER_LABEL_EMPHASIS_FONT : COUNTER_LABEL_FONT;
    return ctx.measureText(segment).width;
  };

  let textWidth: number;
  const ptParts = badge && text.includes(' / ') ? text.split(' / ') : null;

  if (ptParts?.length === 2 && (emphasis === 'left' || emphasis === 'right')) {
    const separator = ' / ';
    textWidth =
      measureWithEmphasis(ptParts[0], emphasis === 'left') +
      measureWithEmphasis(separator, false) +
      measureWithEmphasis(ptParts[1], emphasis === 'right');
  } else if (emphasis === 'all') {
    ctx.font = badge ? COUNTER_LABEL_EMPHASIS_FONT : style.font;
    textWidth = ctx.measureText(text).width;
  } else {
    ctx.font = badge ? COUNTER_LABEL_FONT : style.font;
    textWidth = ctx.measureText(text).width;
  }

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

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  const centerY = textCanvas.height / 2;

  if (ptParts?.length === 2 && (emphasis === 'left' || emphasis === 'right')) {
    const separator = ' / ';
    const segments = [
      { text: ptParts[0], emphasized: emphasis === 'left' },
      { text: separator, emphasized: false },
      { text: ptParts[1], emphasized: emphasis === 'right' },
    ];
    let cursorX = (textCanvas.width - textWidth) / 2;
    for (const segment of segments) {
      ctx.font = segment.emphasized ? COUNTER_LABEL_EMPHASIS_FONT : COUNTER_LABEL_FONT;
      ctx.textAlign = 'left';
      const segmentWidth = ctx.measureText(segment.text).width;
      ctx.fillText(segment.text, cursorX, centerY);
      cursorX += segmentWidth;
    }
  } else {
    ctx.font =
      emphasis === 'all'
        ? badge
          ? COUNTER_LABEL_EMPHASIS_FONT
          : style.font
        : badge
          ? COUNTER_LABEL_FONT
          : style.font;
    ctx.textAlign = 'center';
    ctx.fillText(text, textCanvas.width / 2, centerY);
  }

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
      if (value && name.toLowerCase() === 'token') return 'Token';
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
  const labelText = getCounterLabel(value, counter.name, expanded || counter.id === 'token');

  mesh.position.set(
    (CARD_WIDTH / 2 + label.width / 2) * (card.mesh.userData.isFlipped ? -1 : 1),
    CARD_HEIGHT / 2 - index * (label.height + 0.25) - 2.5,
    CARD_THICKNESS / 2 + 0.05,
  );
  applyCounterLabelAppearance(mesh, card.id, counter.id, labelText);
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
    .filter(
      modifier =>
        modifier.counter &&
        shouldRenderLoyaltyCounterOnCard(card, modifier.counter) &&
        (typeof modifier.value === 'number' || modifier.value),
    )
    .sort((a, b) => {
      if (a.value === b.value) return a.counter.name.localeCompare(b.counter.name);
      return b.value - a.value;
    });

  modifiers.forEach((modifier, index) => {
    applyCounterLayout(card, modifier.counter, modifier.value, index, expanded);
  });
}

function removeOrphanedCounterMeshes(card: Card, activeCounterIds: Set<string>) {
  if (!card.mesh) return;
  for (const [counterId, mesh] of Object.entries(card.modifiers)) {
    if (NON_COUNTER_MODIFIER_MESH_KEYS.has(counterId) || activeCounterIds.has(counterId)) continue;
    card.mesh.remove(mesh as Mesh);
  }
}

function updateCounter(
  card: Card,
  counter: { id: string; name: string; color: string } | undefined,
  value: number | string | boolean,
  index: number,
) {
  if (!counter?.id || !card.mesh) return;
  if (!shouldRenderLoyaltyCounterOnCard(card, counter)) {
    if (card.modifiers[counter.id]) {
      card.mesh.remove(card.modifiers[counter.id]);
    }
    return;
  }
  if (!card.modifiers[counter.id]) {
    let geometry = new BoxGeometry(1, 1, 1);
    let mat = new MeshStandardMaterial({ color: 0xffffff });
    let mesh = new Mesh(geometry, [blackMat, blackMat, blackMat, blackMat, mat, mat]);
    mesh.scale.set(1, 3, CARD_THICKNESS + 0.1);
    card.mesh.add(mesh);
    mesh.transparent = true;
    tagCounterLabelMesh(mesh, card, counter.id);
    card.modifiers[counter.id] = mesh;
  } else {
    tagCounterLabelMesh(card.modifiers[counter.id] as Mesh, card, counter.id);
  }
  if (typeof value === 'number' || value) {
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
      tagCounterLabelMesh(mesh, card, 'pt');
      mesh.position.set(CARD_WIDTH / 2, -CARD_HEIGHT / 2 - 0.25, CARD_THICKNESS / 2 + 0.05);
      card.modifiers.pt = mesh;
    }
    let mesh = card.modifiers.pt as Mesh;
    tagCounterLabelMesh(mesh, card, 'pt');
    if (!card.mesh.children.includes(mesh)) {
      card.mesh.add(mesh);
    }
    const labelText = `${power > 0 ? '+' : ''}${power} / ${toughness > 0 ? '+' : ''}${toughness}`;
    const layoutLabel = createLabel(labelText, true);
    const xPosition =
      (CARD_WIDTH / 2 - layoutLabel.width / 2) * (card.mesh.userData.isFlipped ? -1 : 1);
    mesh.position.set(
      xPosition,
      -CARD_HEIGHT / 2 - 0.25,
      CARD_THICKNESS / 2 + 0.05,
    );
    applyCounterLabelAppearance(mesh, card.id, 'pt', labelText);
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
    .filter(
      modifier =>
        modifier.counter &&
        shouldRenderLoyaltyCounterOnCard(card, modifier.counter) &&
        (typeof modifier.value === 'number' || modifier.value),
    );

  if (card.mesh.userData.isToken) {
    modifiers.push({ counter: { name: 'token', id: 'token' }, value: card.mesh.userData.isToken });
  }

  const activeCounterIds = new Set(modifiers.map(modifier => modifier.counter.id));

  if (!modifiers.length) {
    removeOrphanedCounterMeshes(card, activeCounterIds);
    return;
  }

  modifiers
    .sort((a, b) => {
      if (a.value === b.value) return a.counter.name.localeCompare(b.counter.name);
      return b.value - a.value;
    })
    .forEach((modifier, index) => {
      updateCounter(card, modifier.counter, modifier.value, index);
    });

  removeOrphanedCounterMeshes(card, activeCounterIds);
}

export function getSerializableCard(cardMesh: Object3D) {
  return {
    detail: slimCardDetailForLog(cardMesh.userData.card.detail),
    id: cardMesh.userData.id,
    userData: serializeCardUserDataForLog(cardMesh.userData),
    position: cardMesh.position.toArray(),
    rotation: cardMesh.rotation.toArray(),
  };
}
