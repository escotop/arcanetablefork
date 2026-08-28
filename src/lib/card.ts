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
  Raycaster,
  SRGBColorSpace,
  Texture,
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
import { cleanupFromNode, isValidMaterial } from './utils';
import { serializeCardUserDataForLog } from './gameLogEvents';

export interface CardUserData {
  cardBack?: Material;
  publicCardBack?: Material;
  resting?: Vector3Like;
}

let alphaMap: Texture;
const blackMat = new MeshStandardMaterial({ color: 0x000000 });

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

export async function loadCardTextures(
  card: Card,
  cache: Map<string, Promise<MeshStandardMaterial>> = new Map(),
) {
  const [front, back] = card.mesh.userData.card_face_urls;

  // TODO: it would be nice to make a placeholder card
  // the worker here like we do in the deck editor
  if (!front) throw new Error('front texture not found');

  if (!cache.has(front)) {
    cache.set(
      front,
      textureLoaderWorker.loadTexture(front).then(image => {
        const map = new Texture(image);
        map.colorSpace = SRGBColorSpace;
        map.needsUpdate = true;

        let mat = new MeshStandardMaterial({
          color: 0xffffff,
          map,
          alphaMap,
        });
        mat.transparent = true;
        mat.needsUpdate = true;
        return mat;
      }),
    );
  }

  let frontPromise = cache.get(front);

  if (frontPromise) {
    frontPromise.then(mat => {
      card.mesh.material[4] = mat.clone();
    });
  }

  if (back) {
    if (!cache.has(back)) {
      cache.set(
        back,
        textureLoaderWorker.loadTexture(back).then(image => {
          const map = new Texture(image);
          map.colorSpace = SRGBColorSpace;
          map.needsUpdate = true;

          let mat = new MeshStandardMaterial({
            color: 0xffffff,
            map,
            alphaMap,
          });
          mat.transparent = true;
          mat.needsUpdate = true;

          return mat;
        }),
      );
    }

    let backPromise = cache.get(back)!;

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
  setCardData(newCard.mesh, 'isToken', true);
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
  cardMesh.quaternion.copy(getRotationFromCardState(cardMesh.userData));
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
  if (format === 'scryfall') {
    return uris.large ?? uris.normal;
  }

  const full = Object.values(uris.full ?? {});
  if (full.length > 0) return full[0];

  const art = Object.values(uris.art ?? {});
  if (art.length > 0) return art[0];

  return uris.large ?? uris.normal;
}

export function getCardImage(card: DetailedCardEntry, face = 0) {
  return resolveImageUrl(getImageUris(card, face));
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
        console.warn(`Invalid material assigned to mesh!`, {
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
textCanvas.height = 55;

export function createLabel(text: string, color?: string) {
  const ctx = textCanvas.getContext('2d', { willReadFrequently: true })!;
  const font = '48px grobold';

  ctx.font = font;
  const textWidth = ctx.measureText(text).width;

  textCanvas.width = Math.ceil(textWidth + 24);

  ctx.font = font;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.fillStyle = 'white';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, textCanvas.width / 2 - textWidth / 2, textCanvas.height / 2);

  const texture = new Texture(ctx.getImageData(0, 0, textCanvas.width, textCanvas.height));
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, width: textCanvas.width / 31 };
}

function getCounterLabel(value: number | string, name: string) {
  switch (typeof value) {
    case 'number':
      return `${value.toLocaleString()} ${name}`;
    case 'boolean':
      return value ? `is ${name}` : ``;
    default:
      return value.toString();
  }
}

function updateCounter(
  card: Card,
  counter: { id: string; name: string; color: string },
  value: number | string | boolean,
  index: number,
) {
  if (!card.modifiers[counter.id]) {
    let geometry = new BoxGeometry(1, 1, 1);
    let mat = new MeshStandardMaterial({ color: new Color(counter.color) });
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
    let mesh: Mesh = card.modifiers[counter.id];
    let label = createLabel(getCounterLabel(value, counter.name), counter.color);
    mesh.material[4].map = label.texture;
    mesh.material[5].map = label.texture;
    mesh.scale.set(label.width, 3, CARD_THICKNESS);
    mesh.position.set(
      (CARD_WIDTH / 2 + label.width / 2) * (card.mesh.userData.isFlipped ? -1 : 1),
      CARD_HEIGHT / 2 - index * 3.25 - 2.5,
      0,
    );
    mesh.material[4].needsUpdate = true;
    mesh.material[5].needsUpdate = true;
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
      let mat = new MeshStandardMaterial({});
      let mesh = new Mesh(geometry, [blackMat, blackMat, blackMat, blackMat, mat, mat]);
      mesh.scale.set(7, 3, CARD_THICKNESS + 0.1);
      card.mesh.add(mesh);
      mesh.transparent = true;
      mesh.position.set(CARD_WIDTH / 2, -CARD_HEIGHT / 2 - 0.25, 0);
      card.modifiers.pt = mesh;
    }
    let mesh = card.modifiers.pt as Mesh;
    if (!card.mesh.children.includes(mesh)) {
      card.mesh.add(mesh);
    }
    let label = createLabel(
      `${power > 0 ? '+' : ''}${power} / ${toughness > 0 ? '+' : ''}${toughness}`,
    );
    mesh.material[4].map = label.texture;
    mesh.material[5].map = label.texture;
    mesh.scale.setX(label.width);
    let xPosition = (CARD_WIDTH / 2 - label.width / 2) * (card.mesh.userData.isFlipped ? -1 : 1);
    mesh.position.setX(xPosition);
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

  const modifiers = Array.from(modifierCounters).map(counterId => {
    return {
      counter: countersById[counterId],
      value: card.mesh.userData.modifiers?.counters[counterId],
    };
  });

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
