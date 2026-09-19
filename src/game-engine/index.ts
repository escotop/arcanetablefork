/**
 * Game Engine - Nueva arquitectura de sincronización
 * 
 * Exports principales del motor de juego
 */

// Types
export * from './types';

// Core engine
export { GameEngine } from './engine';
export type { GameEngineConfig } from './engine';

// Reducer (pure functions)
export {
  reduce,
  reduceMany,
  createEmptyGameState,
  createZone,
  validateState,
  getCardsInZone,
  getCard,
  getPlayer,
  replay,
} from './reducer';

// RNG utilities
export {
  seededShuffle,
  seededRandomElement,
  seededRandomRange,
} from './rng';

// Sync providers
export { YjsSyncProvider, createYjsSyncProviderFromGlobals } from './sync/YjsSyncProvider';

// Migration helpers
export * from './examples/tap-migration';
