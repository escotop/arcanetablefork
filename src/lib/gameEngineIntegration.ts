/**
 * Game Engine initialization and integration
 * 
 * This module bridges the new game engine with the existing codebase.
 */

import { GameEngine } from '../game-engine';
import { createYjsSyncProviderFromGlobals } from '../game-engine/sync/YjsSyncProvider';
import { PlayerId, CardId, ZoneId, GameState } from '../game-engine/types';
import type { WebsocketProvider } from 'y-websocket';
import type { WebrtcProvider } from 'y-webrtc';
import type { IndexeddbPersistence } from 'y-indexeddb';
import type { Doc } from 'yjs';

// Global engine instance
let gameEngineInstance: GameEngine | null = null;

// Feature flag - TODO: enable gradually
const USE_GAME_ENGINE = true;

/**
 * Initialize the game engine after Yjs is ready
 */
export async function initializeGameEngine(
  gameId: string,
  playerId: string,
  ydoc: Doc,
  provider: WebsocketProvider | WebrtcProvider,
  indexeddbPersistence: IndexeddbPersistence | null,
): Promise<GameEngine> {
  console.log('[GameEngine] Initializing...');

  const syncProvider = createYjsSyncProviderFromGlobals(
    gameId,
    ydoc,
    provider,
    indexeddbPersistence ?? undefined,
  );

  const engine = new GameEngine({
    gameId,
    playerId: PlayerId(playerId),
    syncProvider,
    onStateChange: (state) => {
      // Sync Three.js from state (only when engine has card data)
      if (Object.keys(state.cards).length === 0) return;

      import('../game-engine/view-sync/three-sync').then(({ syncThreeJsFromState }) => {
        syncThreeJsFromState(state);
      }).catch(error => {
        console.error('[GameEngine] Failed to sync view:', error);
      });
    },
    onError: (error) => {
      console.error('[GameEngine] Error:', error);
    },
  });

  await engine.initialize();
  gameEngineInstance = engine;

  // Make available in dev mode for debugging
  if (import.meta.env.DEV) {
    (window as any).gameEngine = engine;
    console.log('[GameEngine] Available at window.gameEngine');
  }

  console.log('[GameEngine] Initialized successfully');
  
  // Convergence validator (dev): only tap/flip on cards present in both systems
  if (import.meta.env.DEV) {
    const { startConvergenceValidator } = await import('../game-engine/validation/convergence-validator');
    const { playAreas, isEventCatchUpComplete } = await import('./globals');

    const stopValidator = startConvergenceValidator(
      () => playAreas,
      () => engine.getState(),
      {
        intervalMs: 5000,
        isReady: () => isEventCatchUpComplete(),
      },
    );

    (engine as any)._stopValidator = stopValidator;
  }
  
  return engine;
}

/**
 * Get the current game engine instance
 */
export function getGameEngine(): GameEngine | null {
  return gameEngineInstance;
}

/**
 * Check if game engine is enabled
 */
export function isGameEngineEnabled(): boolean {
  return USE_GAME_ENGINE && gameEngineInstance !== null;
}

/**
 * Reset the game engine (for teardown)
 */
export function teardownGameEngine(): void {
  if (gameEngineInstance) {
    // Stop validator if running
    if ((gameEngineInstance as any)._stopValidator) {
      (gameEngineInstance as any)._stopValidator();
    }
    
    gameEngineInstance.destroy();
    gameEngineInstance = null;
    
    if (import.meta.env.DEV) {
      delete (window as any).gameEngine;
    }
    
    console.log('[GameEngine] Torn down');
  }
}
