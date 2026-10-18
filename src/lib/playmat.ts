import {
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { CARD_ZONE_COLOR } from './constants';
import type { CardArea } from './cardArea';
import { getLocalPlayArea, players, playAreas, provider, settings } from './globals';
import type { PlayArea } from './playArea';
import { shopifyPlaymatImageUrl } from './mtgplaymats/client';

export type SavedPlaymat = {
  id: number;
  title: string;
  imageUrl: string;
  productUrl: string;
};

const textureLoader = new TextureLoader();

function playmatTextureLoadUrl(imageUrl: string) {
  const sized = shopifyPlaymatImageUrl(imageUrl, 1200);
  return `/image-proxy?uri=${encodeURIComponent(sized)}`;
}

function playmatApplyKey(playmat?: SavedPlaymat) {
  if (!playmat?.imageUrl) return '';
  return `${playmat.id}|${playmat.imageUrl}`;
}

function clearBattlefieldPlaymatTexture(zone: CardArea) {
  const material = zone.mesh.material as MeshStandardMaterial;
  const existing = zone.mesh.userData.playmatTexture as Texture | undefined;
  if (existing) {
    existing.dispose();
    zone.mesh.userData.playmatTexture = undefined;
  }
  material.map = null;
  material.color.setHex(CARD_ZONE_COLOR);
  material.needsUpdate = true;
}

export function applyPlaymatToBattlefield(zone: CardArea, playmat?: SavedPlaymat) {
  if (zone.zone !== 'battlefield') return;

  const nextKey = playmatApplyKey(playmat);
  if (zone.mesh.userData.appliedPlaymatKey === nextKey) return;
  zone.mesh.userData.appliedPlaymatKey = nextKey;

  clearBattlefieldPlaymatTexture(zone);
  if (!playmat?.imageUrl) return;

  const url = playmatTextureLoadUrl(playmat.imageUrl);
  textureLoader.setCrossOrigin('anonymous');
  textureLoader.load(
    url,
    texture => {
      if (zone.mesh.userData.appliedPlaymatKey !== nextKey) {
        texture.dispose();
        return;
      }
      texture.colorSpace = SRGBColorSpace;
      const material = zone.mesh.material as MeshStandardMaterial;
      const previous = zone.mesh.userData.playmatTexture as Texture | undefined;
      if (previous && previous !== texture) previous.dispose();
      material.map = texture;
      material.color.setHex(0xffffff);
      material.needsUpdate = true;
      zone.mesh.userData.playmatTexture = texture;
    },
    undefined,
    () => {
      if (zone.mesh.userData.appliedPlaymatKey === nextKey) {
        zone.mesh.userData.appliedPlaymatKey = '';
      }
      clearBattlefieldPlaymatTexture(zone);
    },
  );
}

export function applyPlaymatToPlayArea(playArea: PlayArea, playmat?: SavedPlaymat) {
  applyPlaymatToBattlefield(playArea.battlefieldZone, playmat);
}

export function parseSavedPlaymat(value: unknown): SavedPlaymat | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'number' ||
    typeof record.title !== 'string' ||
    typeof record.imageUrl !== 'string'
  ) {
    return undefined;
  }
  return {
    id: record.id,
    title: record.title,
    imageUrl: record.imageUrl,
    productUrl: typeof record.productUrl === 'string' ? record.productUrl : '',
  };
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

export function getPlaymatForPlayArea(playArea: PlayArea): SavedPlaymat | undefined {
  for (const player of players()) {
    if (!awarenessEntryMatchesPlayArea(playArea, player.id, player.entry)) continue;
    return parseSavedPlaymat(player.entry.playmat);
  }

  if (!provider?.awareness) return undefined;
  for (const [awarenessClientId, entry] of provider.awareness.getStates()) {
    if (!awarenessEntryMatchesPlayArea(playArea, awarenessClientId, entry)) continue;
    return parseSavedPlaymat(entry.playmat);
  }

  return undefined;
}

export function publishLocalPlaymatToAwareness() {
  if (!provider?.awareness) return;
  const playmat = settings.playmat;
  provider.awareness.setLocalStateField('playmat', playmat ?? null);
}

export function syncPlaymatForPlayArea(playArea: PlayArea) {
  applyPlaymatToPlayArea(playArea, getPlaymatForPlayArea(playArea));
}

export function syncAllPlaymats() {
  for (const area of Object.values(playAreas)) {
    if (area) syncPlaymatForPlayArea(area);
  }
}

export function syncLocalPlaymat() {
  const area = getLocalPlayArea();
  if (!area) return;
  applyPlaymatToPlayArea(area, settings.playmat);
  publishLocalPlaymatToAwareness();
}
