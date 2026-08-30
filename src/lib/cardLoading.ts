import { nanoid } from 'nanoid';
import { MeshStandardMaterial } from 'three';
import { Card } from './constants';
import { cardsById } from './globals';
import { ensureCardMesh, loadCardTextures } from './card';
import type { CardStack } from './cardStack';

export const ZONE_PRELOAD_TEXTURE_COUNT = 10;

type TextureCache = Map<string, Promise<MeshStandardMaterial>>;

export function cardFromDeckEntry(entry: unknown, clientId: number): Card {
  const record = entry as {
    id?: string;
    detail?: Card['detail'];
    userData?: { card?: { detail?: Card['detail'] }; id?: string };
    mesh?: Card['mesh'];
  };

  if (record.userData?.card) {
    const card: Card = {
      id: record.id ?? record.userData.id ?? nanoid(),
      clientId,
      detail: record.userData.card.detail ?? record.detail!,
      modifiers: {} as Card['modifiers'],
    };
    cardsById.set(card.id, card);
    return card;
  }

  const card: Card = {
    id: record.id || nanoid(),
    clientId,
    detail: record.detail!,
    customArtUrl: (record as { customArtUrl?: string }).customArtUrl,
    modifiers: {} as Card['modifiers'],
    mesh: record.mesh,
  };

  if (card.mesh?.userData?.id === card.id) {
    cardsById.set(card.id, card);
    return card;
  }

  if (card.mesh) {
    card.mesh = undefined;
  }

  cardsById.set(card.id, card);
  return card;
}

export async function preloadStackTextures(zone: CardStack, cache: TextureCache = new Map()) {
  const topCards = zone.cards.slice(-ZONE_PRELOAD_TEXTURE_COUNT).filter(card => card.mesh);
  await Promise.all(topCards.map(card => loadCardTextures(card, cache)));
  scheduleDeferredStackTextures(zone, cache);
}

function scheduleDeferredStackTextures(zone: CardStack, cache: TextureCache) {
  const remaining = zone.cards
    .slice(0, Math.max(0, zone.cards.length - ZONE_PRELOAD_TEXTURE_COUNT))
    .filter(card => card.mesh);

  if (!remaining.length) return;

  let index = 0;
  const loadNext = () => {
    if (index >= remaining.length) return;
    const card = remaining[index++];
    void loadCardTextures(card, cache).finally(() => requestAnimationFrame(loadNext));
  };

  requestAnimationFrame(loadNext);
}

export function onStackCardAdded(zone: CardStack) {
  const cache = new Map<string, Promise<MeshStandardMaterial>>();
  void preloadStackTextures(zone, cache).finally(() => cache.clear());
}
