/**
 * Tests for the game engine reducer
 */

import { describe, test, expect } from 'vitest';
import {
  reduce,
  reduceMany,
  createEmptyGameState,
  createZone,
  validateState,
  getCardsInZone,
  replay,
} from '../reducer';
import {
  GameState,
  GameEvent,
  PlayerId,
  CardId,
  ZoneId,
  EventId,
  CardTappedPayload,
  CardFlippedPayload,
  CardMovedPayload,
  PlayerJoinedPayload,
  CardCreatedPayload,
  ZoneShuffledPayload,
} from '../types';

describe('Reducer', () => {
  describe('createEmptyGameState', () => {
    test('creates valid empty state', () => {
      const state = createEmptyGameState('game-1', 'seed-123');
      
      expect(state.gameId).toBe('game-1');
      expect(state.version).toBe(1);
      expect(state.sequence).toBe(0);
      expect(state.players).toEqual({});
      expect(state.cards).toEqual({});
      expect(state.zones).toEqual({});
      expect(state.rng.seed).toBe('seed-123');
      expect(state.rng.counter).toBe(0);
    });
  });

  describe('PLAYER_JOINED', () => {
    test('adds player to state', () => {
      const state = createEmptyGameState('game-1', 'seed');
      
      const event: GameEvent<PlayerJoinedPayload> = {
        eventId: EventId('e1'),
        sequence: 1,
        timestamp: Date.now(),
        playerId: PlayerId('p1'),
        type: 'PLAYER_JOINED',
        payload: {
          playerId: PlayerId('p1'),
          name: 'Alice',
          life: 20,
          commanderLife: 40,
          color: '#ff0000',
        },
      };

      const newState = reduce(state, event);

      expect(newState.sequence).toBe(1);
      expect(newState.players[PlayerId('p1')]).toEqual({
        id: PlayerId('p1'),
        name: 'Alice',
        life: 20,
        commanderLife: 40,
        commanderDamage: {},
        color: '#ff0000',
        counters: {},
        isActive: true,
        hasPriority: false,
      });
    });

    test('does not modify state for duplicate player', () => {
      let state = createEmptyGameState('game-1', 'seed');
      
      const event: GameEvent<PlayerJoinedPayload> = {
        eventId: EventId('e1'),
        sequence: 1,
        timestamp: Date.now(),
        playerId: PlayerId('p1'),
        type: 'PLAYER_JOINED',
        payload: {
          playerId: PlayerId('p1'),
          name: 'Alice',
          life: 20,
          commanderLife: 40,
          color: '#ff0000',
        },
      };

      state = reduce(state, event);
      const stateBeforeDupe = state;
      
      const dupeEvent: GameEvent<PlayerJoinedPayload> = {
        ...event,
        eventId: EventId('e2'),
        sequence: 2,
      };

      const newState = reduce(state, dupeEvent);
      expect(newState.players[PlayerId('p1')]).toEqual(stateBeforeDupe.players[PlayerId('p1')]);
    });
  });

  describe('CARD_CREATED', () => {
    test('creates card and adds to zone', () => {
      let state = createEmptyGameState('game-1', 'seed');
      
      // Create player and zone first
      const zone = createZone(
        ZoneId('zone-battlefield'),
        'battlefield',
        PlayerId('p1'),
        true,
      );
      state = {
        ...state,
        zones: { [zone.id]: zone },
      };

      const event: GameEvent<CardCreatedPayload> = {
        eventId: EventId('e1'),
        sequence: 1,
        timestamp: Date.now(),
        playerId: PlayerId('p1'),
        type: 'CARD_CREATED',
        payload: {
          cardId: CardId('card-1'),
          ownerId: PlayerId('p1'),
          zoneId: ZoneId('zone-battlefield'),
          name: 'Lightning Bolt',
          scryfallId: 'bolt-123',
        },
      };

      const newState = reduce(state, event);

      expect(newState.cards[CardId('card-1')]).toMatchObject({
        id: CardId('card-1'),
        ownerId: PlayerId('p1'),
        zoneId: ZoneId('zone-battlefield'),
        name: 'Lightning Bolt',
        scryfallId: 'bolt-123',
        tapped: false,
        flipped: false,
        counters: {},
      });

      expect(newState.zones[ZoneId('zone-battlefield')].cardIds).toContain(CardId('card-1'));
    });
  });

  describe('CARD_TAPPED', () => {
    test('toggles card tap state', () => {
      let state = createEmptyGameState('game-1', 'seed');
      
      // Setup: create zone and card
      const zone = createZone(ZoneId('zone-bf'), 'battlefield', PlayerId('p1'), true);
      state = {
        ...state,
        sequence: 0,
        zones: { [zone.id]: zone },
        cards: {
          [CardId('card-1')]: {
            id: CardId('card-1'),
            ownerId: PlayerId('p1'),
            zoneId: ZoneId('zone-bf'),
            name: 'Test Card',
            tapped: false,
            flipped: false,
            faceDown: false,
            phased: false,
            counters: {},
            powerModifier: 0,
            toughnessModifier: 0,
            attachedCards: [],
            isToken: false,
            isClone: false,
          },
        },
      };

      const tapEvent: GameEvent<CardTappedPayload> = {
        eventId: EventId('e1'),
        sequence: 1,
        timestamp: Date.now(),
        playerId: PlayerId('p1'),
        type: 'CARD_TAPPED',
        payload: {
          cardId: CardId('card-1'),
          tapped: true,
        },
      };

      const tappedState = reduce(state, tapEvent);
      expect(tappedState.cards[CardId('card-1')].tapped).toBe(true);

      const untapEvent: GameEvent<CardTappedPayload> = {
        ...tapEvent,
        eventId: EventId('e2'),
        sequence: 2,
        payload: {
          cardId: CardId('card-1'),
          tapped: false,
        },
      };

      const untappedState = reduce(tappedState, untapEvent);
      expect(untappedState.cards[CardId('card-1')].tapped).toBe(false);
    });
  });

  describe('CARD_MOVED', () => {
    test('moves card between zones', () => {
      let state = createEmptyGameState('game-1', 'seed');
      
      // Setup: two zones
      const handZone = createZone(ZoneId('zone-hand'), 'hand', PlayerId('p1'), false);
      const bfZone = createZone(ZoneId('zone-bf'), 'battlefield', PlayerId('p1'), true);
      
      state = {
        ...state,
        zones: {
          [handZone.id]: handZone,
          [bfZone.id]: bfZone,
        },
        cards: {
          [CardId('card-1')]: {
            id: CardId('card-1'),
            ownerId: PlayerId('p1'),
            zoneId: handZone.id,
            name: 'Test Card',
            tapped: false,
            flipped: false,
            faceDown: false,
            phased: false,
            counters: {},
            powerModifier: 0,
            toughnessModifier: 0,
            attachedCards: [],
            isToken: false,
            isClone: false,
          },
        },
      };
      
      // Add card to hand zone
      state = {
        ...state,
        zones: {
          ...state.zones,
          [handZone.id]: {
            ...handZone,
            cardIds: [CardId('card-1')],
          },
        },
      };

      const moveEvent: GameEvent<CardMovedPayload> = {
        eventId: EventId('e1'),
        sequence: 1,
        timestamp: Date.now(),
        playerId: PlayerId('p1'),
        type: 'CARD_MOVED',
        payload: {
          cardId: CardId('card-1'),
          fromZoneId: handZone.id,
          toZoneId: bfZone.id,
        },
      };

      const newState = reduce(state, moveEvent);

      // Card should be in new zone
      expect(newState.cards[CardId('card-1')].zoneId).toBe(bfZone.id);
      
      // Old zone should not contain card
      expect(newState.zones[handZone.id].cardIds).not.toContain(CardId('card-1'));
      
      // New zone should contain card
      expect(newState.zones[bfZone.id].cardIds).toContain(CardId('card-1'));
    });
  });

  describe('ZONE_SHUFFLED', () => {
    test('reorders cards in zone and updates RNG', () => {
      let state = createEmptyGameState('game-1', 'seed');
      
      const deckZone = createZone(ZoneId('zone-deck'), 'deck', PlayerId('p1'), false);
      const cardIds = [CardId('c1'), CardId('c2'), CardId('c3')];
      
      state = {
        ...state,
        zones: {
          [deckZone.id]: {
            ...deckZone,
            cardIds,
          },
        },
      };

      const shuffleEvent: GameEvent<ZoneShuffledPayload> = {
        eventId: EventId('e1'),
        sequence: 1,
        timestamp: Date.now(),
        playerId: PlayerId('p1'),
        type: 'ZONE_SHUFFLED',
        payload: {
          zoneId: deckZone.id,
          rngCounter: 1,
          newOrder: [CardId('c3'), CardId('c1'), CardId('c2')],
        },
      };

      const newState = reduce(state, shuffleEvent);

      expect(newState.zones[deckZone.id].cardIds).toEqual([
        CardId('c3'),
        CardId('c1'),
        CardId('c2'),
      ]);
      expect(newState.rng.counter).toBe(1);
    });
  });

  describe('reduceMany', () => {
    test('applies multiple events in order', () => {
      const state = createEmptyGameState('game-1', 'seed');

      const events: GameEvent[] = [
        {
          eventId: EventId('e1'),
          sequence: 1,
          timestamp: Date.now(),
          playerId: PlayerId('p1'),
          type: 'PLAYER_JOINED',
          payload: {
            playerId: PlayerId('p1'),
            name: 'Alice',
            life: 20,
            commanderLife: 40,
            color: '#ff0000',
          },
        },
        {
          eventId: EventId('e2'),
          sequence: 2,
          timestamp: Date.now(),
          playerId: PlayerId('p2'),
          type: 'PLAYER_JOINED',
          payload: {
            playerId: PlayerId('p2'),
            name: 'Bob',
            life: 20,
            commanderLife: 40,
            color: '#0000ff',
          },
        },
      ];

      const newState = reduceMany(state, events);

      expect(newState.sequence).toBe(2);
      expect(Object.keys(newState.players)).toHaveLength(2);
      expect(newState.players[PlayerId('p1')].name).toBe('Alice');
      expect(newState.players[PlayerId('p2')].name).toBe('Bob');
    });
  });

  describe('replay', () => {
    test('can replay from snapshot', () => {
      const snapshot = createEmptyGameState('game-1', 'seed');

      const events: GameEvent<PlayerJoinedPayload>[] = [
        {
          eventId: EventId('e1'),
          sequence: 1,
          timestamp: Date.now(),
          playerId: PlayerId('p1'),
          type: 'PLAYER_JOINED',
          payload: {
            playerId: PlayerId('p1'),
            name: 'Alice',
            life: 20,
            commanderLife: 40,
            color: '#ff0000',
          },
        },
      ];

      const finalState = replay(snapshot, events);

      expect(finalState.sequence).toBe(1);
      expect(finalState.players[PlayerId('p1')]).toBeDefined();
    });
  });

  describe('validateState', () => {
    test('detects card in invalid zone', () => {
      const state: GameState = {
        ...createEmptyGameState('game-1', 'seed'),
        cards: {
          [CardId('card-1')]: {
            id: CardId('card-1'),
            ownerId: PlayerId('p1'),
            zoneId: ZoneId('invalid-zone'),
            name: 'Test',
            tapped: false,
            flipped: false,
            faceDown: false,
            phased: false,
            counters: {},
            powerModifier: 0,
            toughnessModifier: 0,
            attachedCards: [],
            isToken: false,
            isClone: false,
          },
        },
      };

      const errors = validateState(state);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('invalid zone');
    });

    test('detects zone referencing missing card', () => {
      const zone = createZone(ZoneId('zone-1'), 'battlefield', PlayerId('p1'), true);
      
      const state: GameState = {
        ...createEmptyGameState('game-1', 'seed'),
        zones: {
          [zone.id]: {
            ...zone,
            cardIds: [CardId('missing-card')],
          },
        },
      };

      const errors = validateState(state);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('missing card');
    });
  });
});
