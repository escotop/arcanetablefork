/**
 * Pure reducer: GameState × GameEvent → GameState
 * 
 * This is the heart of the game engine. It's a pure function that takes
 * the current state and an event, and returns the new state.
 * 
 * Rules:
 * - Must be pure (same inputs → same outputs)
 * - No side effects (no network, no mutations, no random)
 * - No Three.js, no Yjs, no UI dependencies
 * - Deterministic (can replay events to get exact state)
 */

import { nanoid } from 'nanoid';
import {
  GameState,
  GameEvent,
  CardId,
  ZoneId,
  PlayerId,
  CardState,
  ZoneState,
  PlayerState,
  CardTappedPayload,
  CardFlippedPayload,
  CardMovedPayload,
  CardCounterChangedPayload,
  PlayerJoinedPayload,
  PlayerLifeChangedPayload,
  CardCreatedPayload,
  ZoneShuffledPayload,
  Position3D,
} from './types';

/**
 * Main reducer function
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  // Update sequence
  if (event.sequence <= state.sequence) {
    console.warn('Event sequence is not advancing', {
      current: state.sequence,
      event: event.sequence,
    });
    return state;
  }

  const newState = { ...state, sequence: event.sequence };

  switch (event.type) {
    case 'PLAYER_JOINED':
      return reducePlayerJoined(newState, event as GameEvent<PlayerJoinedPayload>);

    case 'PLAYER_LIFE_CHANGED':
      return reducePlayerLifeChanged(newState, event as GameEvent<PlayerLifeChangedPayload>);

    case 'CARD_CREATED':
      return reduceCardCreated(newState, event as GameEvent<CardCreatedPayload>);

    case 'CARD_MOVED':
      return reduceCardMoved(newState, event as GameEvent<CardMovedPayload>);

    case 'CARD_TAPPED':
      return reduceCardTapped(newState, event as GameEvent<CardTappedPayload>);

    case 'CARD_FLIPPED':
      return reduceCardFlipped(newState, event as GameEvent<CardFlippedPayload>);

    case 'CARD_COUNTER_CHANGED':
      return reduceCardCounterChanged(newState, event as GameEvent<CardCounterChangedPayload>);

    case 'ZONE_SHUFFLED':
      return reduceZoneShuffled(newState, event as GameEvent<ZoneShuffledPayload>);

    default:
      console.warn('Unhandled event type:', event.type);
      return newState;
  }
}

/**
 * Batch reduce multiple events
 */
export function reduceMany(state: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce((s, e) => reduce(s, e), state);
}

// ============================================================================
// Individual reducers
// ============================================================================

function reducePlayerJoined(
  state: GameState,
  event: GameEvent<PlayerJoinedPayload>,
): GameState {
  const { playerId, name, life, commanderLife, color } = event.payload;

  if (state.players[playerId]) {
    console.warn('Player already exists:', playerId);
    return state;
  }

  const player: PlayerState = {
    id: playerId,
    name,
    life,
    commanderLife,
    commanderDamage: {},
    color,
    counters: {},
    isActive: true,
    hasPriority: false,
  };

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: player,
    },
  };
}

function reducePlayerLifeChanged(
  state: GameState,
  event: GameEvent<PlayerLifeChangedPayload>,
): GameState {
  const { playerId, newLife } = event.payload;
  const player = state.players[playerId];

  if (!player) {
    console.warn('Player not found:', playerId);
    return state;
  }

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        life: newLife,
      },
    },
  };
}

function reduceCardCreated(
  state: GameState,
  event: GameEvent<CardCreatedPayload>,
): GameState {
  const { cardId, ownerId, zoneId, name, scryfallId, isToken, position } = event.payload;

  if (state.cards[cardId]) {
    console.warn('Card already exists:', cardId);
    return state;
  }

  const card: CardState = {
    id: cardId,
    ownerId,
    zoneId,
    name,
    scryfallId,
    oracleId: undefined,
    set: undefined,
    collectorNumber: undefined,
    tapped: false,
    flipped: false,
    faceDown: false,
    phased: false,
    position,
    rotation: undefined,
    counters: {},
    powerModifier: 0,
    toughnessModifier: 0,
    attachedTo: undefined,
    attachedCards: [],
    isToken: isToken ?? false,
    isClone: false,
    clonedFrom: undefined,
    customArtUrl: undefined,
  };

  // Add card to zone
  const zone = state.zones[zoneId];
  if (!zone) {
    console.warn('Zone not found:', zoneId);
    return state;
  }

  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: card,
    },
    zones: {
      ...state.zones,
      [zoneId]: {
        ...zone,
        cardIds: [...zone.cardIds, cardId],
      },
    },
  };
}

function reduceCardMoved(
  state: GameState,
  event: GameEvent<CardMovedPayload>,
): GameState {
  const { cardId, fromZoneId, toZoneId, position, index, faceDown } = event.payload;

  const card = state.cards[cardId];
  if (!card) {
    console.warn('Card not found:', cardId);
    return state;
  }

  const fromZone = state.zones[fromZoneId];
  const toZone = state.zones[toZoneId];

  if (!fromZone || !toZone) {
    console.warn('Zone not found:', { fromZoneId, toZoneId });
    return state;
  }

  // Remove from old zone
  const fromCardIds = fromZone.cardIds.filter(id => id !== cardId);

  // Add to new zone
  let toCardIds: CardId[];
  if (index !== undefined) {
    toCardIds = [...toZone.cardIds];
    toCardIds.splice(index, 0, cardId);
  } else {
    toCardIds = [...toZone.cardIds, cardId];
  }

  // Update card
  const updatedCard: CardState = {
    ...card,
    zoneId: toZoneId,
    position,
    faceDown: faceDown ?? card.faceDown,
    // Reset tap when moving (unless going to battlefield)
    tapped: toZone.type === 'battlefield' ? card.tapped : false,
  };

  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: updatedCard,
    },
    zones: {
      ...state.zones,
      [fromZoneId]: {
        ...fromZone,
        cardIds: fromCardIds,
      },
      [toZoneId]: {
        ...toZone,
        cardIds: toCardIds,
      },
    },
  };
}

function reduceCardTapped(
  state: GameState,
  event: GameEvent<CardTappedPayload>,
): GameState {
  const { cardId, tapped } = event.payload;

  const card = state.cards[cardId];
  if (!card) {
    return state;
  }

  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: {
        ...card,
        tapped,
      },
    },
  };
}

function reduceCardFlipped(
  state: GameState,
  event: GameEvent<CardFlippedPayload>,
): GameState {
  const { cardId, flipped } = event.payload;

  const card = state.cards[cardId];
  if (!card) {
    return state;
  }

  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: {
        ...card,
        flipped,
      },
    },
  };
}

function reduceCardCounterChanged(
  state: GameState,
  event: GameEvent<CardCounterChangedPayload>,
): GameState {
  const { cardId, counterId, newValue } = event.payload;

  const card = state.cards[cardId];
  if (!card) {
    console.warn('Card not found:', cardId);
    return state;
  }

  const updatedCounters = { ...card.counters };
  if (newValue === 0) {
    delete updatedCounters[counterId];
  } else {
    updatedCounters[counterId] = newValue;
  }

  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: {
        ...card,
        counters: updatedCounters,
      },
    },
  };
}

function reduceZoneShuffled(
  state: GameState,
  event: GameEvent<ZoneShuffledPayload>,
): GameState {
  const { zoneId, rngCounter, newOrder } = event.payload;

  const zone = state.zones[zoneId];
  if (!zone) {
    console.warn('Zone not found:', zoneId);
    return state;
  }

  return {
    ...state,
    zones: {
      ...state.zones,
      [zoneId]: {
        ...zone,
        cardIds: newOrder,
      },
    },
    rng: {
      ...state.rng,
      counter: rngCounter,
    },
  };
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Create an empty game state
 */
export function createEmptyGameState(gameId: string, seed: string): GameState {
  return {
    version: 1,
    gameId,
    sequence: 0,
    players: {},
    cards: {},
    zones: {},
    turn: {
      number: 0,
      phase: 'beginning',
      step: null,
      activePlayerId: PlayerId(''),
      priorityPlayerId: null,
      turnOrder: [],
    },
    stack: [],
    counters: {},
    rng: {
      seed,
      counter: 0,
    },
  };
}

/**
 * Create a zone
 */
export function createZone(
  id: ZoneId,
  type: ZoneState['type'],
  ownerId: PlayerId,
  isPublic: boolean = false,
): ZoneState {
  return {
    id,
    type,
    ownerId,
    cardIds: [],
    isPublic,
    isOrdered: type === 'deck' || type === 'graveyard' || type === 'exile',
  };
}

/**
 * Replay events from a snapshot
 */
export function replay(
  snapshot: GameState,
  events: readonly GameEvent[],
): GameState {
  return reduceMany(snapshot, events);
}

/**
 * Get all cards in a zone
 */
export function getCardsInZone(state: GameState, zoneId: ZoneId): readonly CardState[] {
  const zone = state.zones[zoneId];
  if (!zone) return [];
  
  return zone.cardIds
    .map(id => state.cards[id])
    .filter((card): card is CardState => card !== undefined);
}

/**
 * Find card by ID
 */
export function getCard(state: GameState, cardId: CardId): CardState | undefined {
  return state.cards[cardId];
}

/**
 * Get player
 */
export function getPlayer(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players[playerId];
}

/**
 * Validate state consistency
 */
export function validateState(state: GameState): string[] {
  const errors: string[] = [];

  // Check that all cards reference valid zones
  Object.values(state.cards).forEach(card => {
    if (!state.zones[card.zoneId]) {
      errors.push(`Card ${card.id} references invalid zone ${card.zoneId}`);
    }
    
    if (!state.players[card.ownerId]) {
      errors.push(`Card ${card.id} references invalid owner ${card.ownerId}`);
    }
  });

  // Check that all zone card references exist
  Object.values(state.zones).forEach(zone => {
    zone.cardIds.forEach(cardId => {
      const card = state.cards[cardId];
      if (!card) {
        errors.push(`Zone ${zone.id} references missing card ${cardId}`);
      } else if (card.zoneId !== zone.id) {
        errors.push(`Card ${cardId} zone mismatch: in zone ${zone.id} but card.zoneId = ${card.zoneId}`);
      }
    });
  });

  return errors;
}
