import {
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { isOpponentPrivateHandCard, loadCardTextures } from './card';
import type { PlayArea } from './playArea';
import {
  cardBackTexture,
  cardSystem,
  DEFAULT_CARD_BACK,
  getLocalPlayArea,
  getLocalPlayerClientId,
  players,
  playAreas,
  provider,
  scene,
  settings,
} from './globals';

export type SavedCardBack = {
  id: string;
  title: string;
  imageUrl: string;
  previewUrl: string;
  sourceName?: string;
};

const textureLoader = new TextureLoader();
const textureByApplyKey = new Map<string, Texture>();
const loadPromises = new Map<string, Promise<Texture>>();

export function parseSavedCardBack(value: unknown): SavedCardBack | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.imageUrl !== 'string'
  ) {
    return undefined;
  }
  const previewUrl =
    typeof record.previewUrl === 'string' ? record.previewUrl : record.imageUrl;
  return {
    id: record.id,
    title: record.title,
    imageUrl: record.imageUrl,
    previewUrl,
    sourceName: typeof record.sourceName === 'string' ? record.sourceName : undefined,
  };
}

function cardBackApplyKey(back?: SavedCardBack) {
  if (!back?.imageUrl) return 'default';
  return `${back.id}|${back.imageUrl}`;
}

export function cardBackTextureUrlFromSaved(back?: SavedCardBack): string {
  if (back?.imageUrl) {
    return `/image-proxy?uri=${encodeURIComponent(back.imageUrl)}`;
  }
  return cardSystem.cardBack ?? DEFAULT_CARD_BACK;
}

function awarenessEntryMatchesPlayArea(
  playArea: PlayArea,
  awarenessClientId: number,
  entry: Record<string, unknown>,
) {
  const sessionId = entry.playerSessionId;
  if (playArea.playerSessionId && sessionId === playArea.playerSessionId) return true;
  return awarenessClientId === playArea.clientId;
}

export function getCardBackForPlayArea(playArea: PlayArea): SavedCardBack | undefined {
  for (const player of players()) {
    if (!awarenessEntryMatchesPlayArea(playArea, player.id, player.entry)) continue;
    return parseSavedCardBack(player.entry.mpcCardBack);
  }

  if (!provider?.awareness) return undefined;
  for (const [awarenessClientId, entry] of provider.awareness.getStates()) {
    if (!awarenessEntryMatchesPlayArea(playArea, awarenessClientId, entry)) continue;
    return parseSavedCardBack(entry.mpcCardBack);
  }

  return undefined;
}

function resolveSavedCardBackForPlayArea(
  playArea: PlayArea,
  explicit?: SavedCardBack,
): SavedCardBack | undefined {
  if (explicit !== undefined) return explicit;
  const localId = getLocalPlayerClientId();
  if (localId !== undefined && playArea.clientId === localId && settings.mpcCardBack) {
    return settings.mpcCardBack;
  }
  return getCardBackForPlayArea(playArea);
}

function configureCardBackTexture(texture: Texture) {
  texture.colorSpace = SRGBColorSpace;
  texture.userData.isCardBack = true;
}

async function loadCardBackTexture(url: string, applyKey: string): Promise<Texture> {
  const cached = textureByApplyKey.get(applyKey);
  if (cached) return cached;

  const pending = loadPromises.get(applyKey);
  if (pending) return pending;

  const defaultUrl = cardSystem.cardBack ?? DEFAULT_CARD_BACK;
  if (applyKey === 'default' && cardBackTexture && url === defaultUrl) {
    configureCardBackTexture(cardBackTexture);
    textureByApplyKey.set(applyKey, cardBackTexture);
    return cardBackTexture;
  }

  const promise = new Promise<Texture>((resolve, reject) => {
    textureLoader.setCrossOrigin('anonymous');
    textureLoader.load(
      url,
      texture => {
        configureCardBackTexture(texture);
        textureByApplyKey.set(applyKey, texture);
        loadPromises.delete(applyKey);
        resolve(texture);
      },
      undefined,
      error => {
        loadPromises.delete(applyKey);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
  loadPromises.set(applyKey, promise);
  return promise;
}

function meshOwnerClientId(mesh: Mesh): number | undefined {
  const raw = mesh.userData.clientId;
  if (raw === undefined || raw === null) return undefined;
  return Number(raw);
}

function applyCardBackToMaterial(material: MeshStandardMaterial | undefined, texture: Texture) {
  if (!material) return;
  material.map = texture;
  material.transparent = true;
  material.needsUpdate = true;
}

function applyCardBackTextureToMesh(mesh: Mesh, texture: Texture, applyKey: string) {
  if (mesh.userData.appliedCardBackKey === applyKey) return;
  mesh.userData.appliedCardBackKey = applyKey;

  if (mesh.userData.isDeckProxy) {
    const materials = mesh.material;
    const backFace = Array.isArray(materials) ? materials[5] : undefined;
    applyCardBackToMaterial(backFace, texture);
    return;
  }

  if (!mesh.userData.id) return;

  const materials = mesh.material;
  if (Array.isArray(materials)) {
    const backFace = materials[5];
    if (backFace instanceof MeshStandardMaterial) {
      applyCardBackToMaterial(backFace, texture);
    }
  }

  applyCardBackToMaterial(mesh.userData.publicCardBack as MeshStandardMaterial | undefined, texture);
  applyCardBackToMaterial(mesh.userData.cardBack as MeshStandardMaterial | undefined, texture);
}

function cardMeshFaceShowsCardBack(mesh: Mesh) {
  const materials = mesh.material;
  if (!Array.isArray(materials)) return false;
  const face = materials[4];
  if (!(face instanceof MeshStandardMaterial)) return false;
  return face.map?.userData?.isCardBack === true;
}

async function refreshPlayAreaFacesAfterCardBack(playArea: PlayArea) {
  if (!playArea.isLocalPlayArea) return;

  const cards = [...playArea.hand.cards, ...playArea.battlefieldZone.cards];
  const stuck = cards.filter(
    card =>
      card.mesh &&
      !isOpponentPrivateHandCard(card) &&
      cardMeshFaceShowsCardBack(card.mesh),
  );
  if (!stuck.length) return;

  await Promise.all(stuck.map(card => loadCardTextures(card)));
}

function applyCardBackTextureToOwner(ownerClientId: number, texture: Texture, applyKey: string) {
  if (!scene) return;
  scene.traverse(obj => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    if (meshOwnerClientId(mesh) !== ownerClientId) return;
    applyCardBackTextureToMesh(mesh, texture, applyKey);
  });
}

export async function applyCardBackForPlayArea(playArea: PlayArea, back?: SavedCardBack) {
  const saved = resolveSavedCardBackForPlayArea(playArea, back);
  const applyKey = cardBackApplyKey(saved);
  const url = cardBackTextureUrlFromSaved(saved);
  try {
    const texture = await loadCardBackTexture(url, applyKey);
    applyCardBackTextureToOwner(playArea.clientId, texture, applyKey);
    await refreshPlayAreaFacesAfterCardBack(playArea);
  } catch (error) {
    console.warn('[cardBack] failed to load texture', url, error);
  }
}

export function publishLocalCardBackToAwareness() {
  if (!provider?.awareness) return;
  provider.awareness.setLocalStateField('mpcCardBack', settings.mpcCardBack ?? null);
}

export function syncCardBackForPlayArea(playArea: PlayArea) {
  void applyCardBackForPlayArea(playArea);
}

export function syncAllCardBacks() {
  for (const area of Object.values(playAreas)) {
    if (area) syncCardBackForPlayArea(area);
  }
}

export function syncLocalCardBack() {
  publishLocalCardBackToAwareness();
  const area = getLocalPlayArea();
  if (area) {
    void applyCardBackForPlayArea(area, settings.mpcCardBack);
  }
}

export async function syncLocalCardBackAndWait() {
  publishLocalCardBackToAwareness();
  const area = getLocalPlayArea();
  if (area) {
    await applyCardBackForPlayArea(area, settings.mpcCardBack);
  }
}

/** @deprecated Use syncLocalCardBack / syncAllCardBacks */
export async function syncCardBackFromSettings() {
  syncLocalCardBack();
  syncAllCardBacks();
}
