/**
 * Three.js View Sync
 * 
 * Synchronizes Three.js scene from GameState.
 * This is the bridge between pure game state and visual representation.
 */

import { GameState, CardState, ZoneState } from '../../game-engine/types';
import { cardsById } from '../../lib/globals';
import { animateObject } from '../../lib/animations';

let lastSyncedSequence = 0;

/**
 * Sync Three.js scene from game state
 */
export function syncThreeJsFromState(state: GameState): void {
  // Skip if no changes
  if (state.sequence === lastSyncedSequence) {
    return;
  }

  const startTime = performance.now();

  try {
    // Sync all cards
    for (const [cardId, cardState] of Object.entries(state.cards)) {
      syncCard(cardId, cardState);
    }

    // Sync zones (counts, visibility, etc.)
    for (const [zoneId, zoneState] of Object.entries(state.zones)) {
      syncZone(zoneId, zoneState);
    }

    lastSyncedSequence = state.sequence;

    const elapsed = performance.now() - startTime;
    if (elapsed > 10) {
      console.warn('[ThreeSync] Slow sync:', elapsed.toFixed(2), 'ms');
    }
  } catch (error) {
    console.error('[ThreeSync] Error syncing:', error);
  }
}

/**
 * Sync a single card's visual representation
 */
function syncCard(cardId: string, cardState: CardState): void {
  const card = cardsById.get(cardId);
  if (!card?.mesh) return;

  const mesh = card.mesh;
  let needsUpdate = false;

  // Sync tap state
  if (mesh.userData.isTapped !== cardState.tapped) {
    mesh.userData.isTapped = cardState.tapped;
    animateCardTap(mesh, cardState.tapped);
    needsUpdate = true;
  }

  // Sync flip state
  if (mesh.userData.isFlipped !== cardState.flipped) {
    mesh.userData.isFlipped = cardState.flipped;
    animateCardFlip(mesh, cardState.flipped);
    needsUpdate = true;
  }

  // Sync position
  if (cardState.position && needsPositionUpdate(mesh, cardState.position)) {
    animateObject(
      mesh,
      {
        x: cardState.position.x,
        y: cardState.position.y,
        z: cardState.position.z,
      },
      { duration: 200 }
    );
    needsUpdate = true;
  }

  // Sync counters
  if (cardState.counters && Object.keys(cardState.counters).length > 0) {
    syncCardCounters(card, cardState.counters);
  }
}

/**
 * Check if position needs update
 */
function needsPositionUpdate(
  mesh: any,
  pos: { x: number; y: number; z: number }
): boolean {
  const EPSILON = 0.01;
  return (
    Math.abs(mesh.position.x - pos.x) > EPSILON ||
    Math.abs(mesh.position.y - pos.y) > EPSILON ||
    Math.abs(mesh.position.z - pos.z) > EPSILON
  );
}

/**
 * Animate card tap
 */
function animateCardTap(mesh: any, tapped: boolean): void {
  const targetRotation = tapped ? Math.PI / 2 : 0;
  
  animateObject(
    mesh,
    { rotation: { z: targetRotation } },
    { duration: 150, easing: 'easeInOutQuad' }
  );
}

/**
 * Animate card flip
 */
function animateCardFlip(mesh: any, flipped: boolean): void {
  const targetRotation = flipped ? Math.PI : 0;
  
  animateObject(
    mesh,
    { rotation: { y: targetRotation } },
    { duration: 200, easing: 'easeInOutQuad' }
  );
}

/**
 * Sync card counters
 */
function syncCardCounters(card: any, counters: Record<string, number>): void {
  // TODO: Implement counter visual sync
  // This will update counter labels/badges on cards
  if (import.meta.env.DEV) {
    console.log('[ThreeSync] Syncing counters for card:', card.id, counters);
  }
}

/**
 * Sync zone state
 */
function syncZone(zoneId: string, zoneState: ZoneState): void {
  // TODO: Implement zone visual sync
  // This will update zone UI elements (card counts, visibility, etc.)
  if (import.meta.env.DEV && false) { // Too verbose
    console.log('[ThreeSync] Syncing zone:', zoneId, zoneState.cardIds.length, 'cards');
  }
}

/**
 * Reset sync state (for testing/debugging)
 */
export function resetSyncState(): void {
  lastSyncedSequence = 0;
}
