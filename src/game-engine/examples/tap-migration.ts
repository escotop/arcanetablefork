/**
 * Example migration: Tap/Untap system
 * 
 * This shows how to migrate from the current system to the new game engine.
 * Use this as a pattern for migrating other subsystems.
 */

import { GameEngine } from '../engine';
import { createYjsSyncProviderFromGlobals } from '../sync/YjsSyncProvider';
import { PlayerId, CardId, ZoneId } from '../types';
import { getCard } from '../reducer';

// ============================================================================
// Step 1: Create bridge to existing globals
// ============================================================================

/**
 * Initialize game engine using existing Yjs infrastructure
 */
export function initializeGameEngine(
  gameId: string,
  playerId: string,
  ydoc: any,
  provider: any,
  persistence: any,
): GameEngine {
  const syncProvider = createYjsSyncProviderFromGlobals(
    gameId,
    ydoc,
    provider,
    persistence,
  );

  const engine = new GameEngine({
    gameId,
    playerId: PlayerId(playerId),
    syncProvider,
    onStateChange: (state) => {
      // Update Three.js scene from new state
      updateThreeJsFromState(state);
    },
    onError: (error) => {
      console.error('[GameEngine] Error:', error);
    },
  });

  return engine;
}

// ============================================================================
// Step 2: State → View synchronization
// ============================================================================

/**
 * Update Three.js scene to match game state
 * 
 * This is called whenever the state changes. It should be FAST because
 * it runs on every event. Only update what changed.
 */
function updateThreeJsFromState(state: any) {
  // Update each card's visual representation
  Object.values(state.cards).forEach((cardState: any) => {
    updateCardVisuals(cardState);
  });
}

/**
 * Update a single card's visual representation
 */
function updateCardVisuals(cardState: any) {
  // Get the Three.js mesh (from existing cardsById or similar)
  const card = getCardMeshById(cardState.id);
  if (!card) return;

  // Update tap state
  if (card.userData.tapped !== cardState.tapped) {
    card.userData.tapped = cardState.tapped;
    animateCardTap(card, cardState.tapped);
  }

  // Update flip state
  if (card.userData.flipped !== cardState.flipped) {
    card.userData.flipped = cardState.flipped;
    animateCardFlip(card, cardState.flipped);
  }

  // Update position if needed
  if (cardState.position) {
    updateCardPosition(card, cardState.position);
  }
}

// ============================================================================
// Step 3: User interaction → Commands
// ============================================================================

/**
 * NEW: Handle card tap via game engine
 */
export function tapCardViaEngine(engine: GameEngine, cardId: string) {
  engine.dispatch({
    type: 'TAP_CARD',
    playerId: engine.getState().players[Object.keys(engine.getState().players)[0]] ? 
      PlayerId(Object.keys(engine.getState().players)[0]) : 
      PlayerId('unknown'),
    payload: { cardId: CardId(cardId) },
  });
}

/**
 * NEW: Handle card untap via game engine
 */
export function untapCardViaEngine(engine: GameEngine, cardId: string) {
  engine.dispatch({
    type: 'UNTAP_CARD',
    playerId: engine.getState().players[Object.keys(engine.getState().players)[0]] ? 
      PlayerId(Object.keys(engine.getState().players)[0]) : 
      PlayerId('unknown'),
    payload: { cardId: CardId(cardId) },
  });
}

// ============================================================================
// Step 4: OLD system compatibility (temporary)
// ============================================================================

/**
 * Bridge: Convert old PlayArea tap to new system
 * 
 * During migration, keep the old API but route through new engine
 */
export function bridgeOldTapToNew(
  engine: GameEngine,
  cardMesh: any,
  options: { skipAnimation?: boolean } = {},
) {
  const cardId = cardMesh.userData.id;
  
  if (!cardId) {
    console.warn('Card has no ID');
    return;
  }

  // Get current state
  const cardState = engine.getCard(CardId(cardId));
  
  if (!cardState) {
    console.warn('Card not in game state:', cardId);
    return;
  }

  // Dispatch command
  engine.dispatch({
    type: cardState.tapped ? 'UNTAP_CARD' : 'TAP_CARD',
    playerId: cardState.ownerId,
    payload: { cardId: CardId(cardId) },
  });

  // Prediction for instant feedback (optional)
  if (!options.skipAnimation) {
    // Optimistically update visual immediately
    cardMesh.userData.tapped = !cardMesh.userData.tapped;
    animateCardTap(cardMesh, cardMesh.userData.tapped);
  }
}

// ============================================================================
// Placeholder functions (implement based on your existing code)
// ============================================================================

function getCardMeshById(cardId: string): any {
  // TODO: Get from existing cardsById map
  return null;
}

function animateCardTap(cardMesh: any, tapped: boolean) {
  // TODO: Use existing animateObject or similar
  console.log('Animating tap:', cardMesh.userData.id, tapped);
}

function animateCardFlip(cardMesh: any, flipped: boolean) {
  // TODO: Use existing flip animation
  console.log('Animating flip:', cardMesh.userData.id, flipped);
}

function updateCardPosition(cardMesh: any, position: { x: number; y: number; z: number }) {
  cardMesh.position.set(position.x, position.y, position.z);
}

// ============================================================================
// Integration example
// ============================================================================

/**
 * Example: How to integrate in existing main3d.ts
 */
export function exampleIntegration() {
  /*
  // In main3d.ts init function:
  
  import { initializeGameEngine } from './game-engine/examples/tap-migration';
  
  // After creating Yjs provider:
  const gameEngine = initializeGameEngine(
    gameId,
    getLocalPlayerClientId(),
    ydoc,
    provider,
    indexeddbPersistence,
  );
  
  await gameEngine.initialize();
  
  // Store globally for access
  window.gameEngine = gameEngine;
  
  // In PlayArea.tap():
  tap(cardMesh: Mesh, options: { skipAnimation?: boolean } = {}) {
    if (window.gameEngine) {
      bridgeOldTapToNew(window.gameEngine, cardMesh, options);
    } else {
      // Fallback to old system
      this.oldTap(cardMesh, options);
    }
  }
  */
}

// ============================================================================
// Migration checklist
// ============================================================================

/*
□ Step 1: Initialize GameEngine in main3d.ts
  - Create sync provider from globals
  - Initialize engine
  - Store reference globally

□ Step 2: Create updateThreeJsFromState
  - Subscribe to state changes
  - Update card meshes
  - Only change what's different (performance!)

□ Step 3: Route user actions through engine
  - Right-click tap → engine.dispatch('TAP_CARD')
  - Keep optimistic updates for responsiveness

□ Step 4: Test dual-system operation
  - Old events still work
  - New commands work
  - No conflicts

□ Step 5: Gradually remove old code
  - Remove locallyApplied logic
  - Remove direct mesh mutations
  - Remove old event handlers

□ Step 6: Full migration
  - All actions go through engine
  - Remove old PlayArea methods
  - Clean up globals
*/
