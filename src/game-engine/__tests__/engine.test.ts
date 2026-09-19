/**
 * Tests for the GameEngine
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { GameEngine } from '../engine';
import {
  GameSyncProvider,
  GameEvent,
  GameSnapshot,
  PlayerId,
  CardId,
  ZoneId,
  EventCallback,
} from '../types';
import { createEmptyGameState, createZone } from '../reducer';

// Mock sync provider
class MockSyncProvider implements GameSyncProvider {
  private events: GameEvent[] = [];
  private snapshot: GameSnapshot | null = null;
  private callbacks: Set<EventCallback> = new Set();

  async append(events: readonly GameEvent[]): Promise<void> {
    this.events.push(...events);
    // Simulate async sync
    await Promise.resolve();
    // Notify subscribers
    this.callbacks.forEach(cb => cb(events));
  }

  subscribe(callback: EventCallback) {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  async getEvents(fromSequence: number): Promise<readonly GameEvent[]> {
    return this.events.filter(e => e.sequence >= fromSequence);
  }

  async saveSnapshot(snapshot: GameSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async loadSnapshot(): Promise<GameSnapshot | null> {
    return this.snapshot;
  }

  async getLatestSequence(): Promise<number> {
    if (this.events.length === 0) return 0;
    return Math.max(...this.events.map(e => e.sequence));
  }

  // Test helpers
  getStoredEvents() {
    return this.events;
  }

  clearEvents() {
    this.events = [];
  }
}

describe('GameEngine', () => {
  let engine: GameEngine;
  let mockProvider: MockSyncProvider;

  beforeEach(() => {
    mockProvider = new MockSyncProvider();
    engine = new GameEngine({
      gameId: 'test-game',
      playerId: PlayerId('p1'),
      syncProvider: mockProvider,
    });
  });

  describe('initialization', () => {
    test('starts with empty state', async () => {
      await engine.initialize();
      const state = engine.getState();
      
      expect(state.gameId).toBe('test-game');
      expect(state.sequence).toBe(0);
      expect(Object.keys(state.players)).toHaveLength(0);
    });

    test('loads from snapshot if available', async () => {
      const baseState = createEmptyGameState('test-game', 'seed');
      const snapshotState = {
        ...baseState,
        sequence: 5,
      };

      await mockProvider.saveSnapshot({
        schemaVersion: 1,
        eventPosition: 5,
        timestamp: Date.now(),
        state: snapshotState,
      });

      await engine.initialize();
      const state = engine.getState();
      
      expect(state.sequence).toBe(5);
    });
  });

  describe('command dispatch', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    test('JOIN_GAME creates PLAYER_JOINED event', async () => {
      await engine.dispatch({
        type: 'JOIN_GAME',
        playerId: PlayerId('p1'),
        payload: {
          name: 'Alice',
          life: 20,
          commanderLife: 40,
          color: '#ff0000',
        },
      });

      const events = mockProvider.getStoredEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PLAYER_JOINED');
      expect(events[0].playerId).toBe(PlayerId('p1'));
    });

    test('TAP_CARD creates CARD_TAPPED event', async () => {
      // Setup: create a zone and card first
      const state = engine.getState();
      const zone = createZone(ZoneId('zone-1'), 'battlefield', PlayerId('p1'), true);
      
      // Manually inject initial state (in real app this would come from events)
      const initState = {
        ...state,
        zones: { [zone.id]: zone },
        cards: {
          [CardId('card-1')]: {
            id: CardId('card-1'),
            ownerId: PlayerId('p1'),
            zoneId: zone.id,
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
      
      // Force state (only for test)
      (engine as any).state = initState;

      await engine.dispatch({
        type: 'TAP_CARD',
        playerId: PlayerId('p1'),
        payload: {
          cardId: CardId('card-1'),
        },
      });

      const events = mockProvider.getStoredEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('CARD_TAPPED');
      expect((events[0].payload as any).cardId).toBe(CardId('card-1'));
      expect((events[0].payload as any).tapped).toBe(true);
    });

    test('SHUFFLE_ZONE creates ZONE_SHUFFLED event with deterministic order', async () => {
      const zone = createZone(ZoneId('deck-1'), 'deck', PlayerId('p1'), false);
      const cards = [CardId('c1'), CardId('c2'), CardId('c3')];
      
      const initState = {
        ...engine.getState(),
        zones: {
          [zone.id]: {
            ...zone,
            cardIds: cards,
          },
        },
      };
      
      (engine as any).state = initState;

      await engine.dispatch({
        type: 'SHUFFLE_ZONE',
        playerId: PlayerId('p1'),
        payload: {
          zoneId: zone.id,
        },
      });

      const events = mockProvider.getStoredEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ZONE_SHUFFLED');
      
      const payload = events[0].payload as any;
      expect(payload.zoneId).toBe(zone.id);
      expect(payload.newOrder).toHaveLength(3);
      expect(payload.rngCounter).toBe(1);
    });
  });

  describe('event application', () => {
    test('applies events from sync provider', async () => {
      await engine.initialize();

      // Simulate event coming from network
      await mockProvider.append([
        {
          eventId: 'e1' as any,
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
      ]);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      const state = engine.getState();
      expect(state.sequence).toBe(1);
      expect(state.players[PlayerId('p1')]).toBeDefined();
      expect(state.players[PlayerId('p1')].name).toBe('Alice');
    });
  });

  describe('subscriptions', () => {
    test('notifies subscribers on state change', async () => {
      await engine.initialize();

      const stateChanges: any[] = [];
      engine.subscribe(state => {
        stateChanges.push(state);
      });

      await mockProvider.append([
        {
          eventId: 'e1' as any,
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
      ]);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[stateChanges.length - 1].sequence).toBe(1);
    });

    test('unsubscribe stops notifications', async () => {
      await engine.initialize();

      let callCount = 0;
      const unsubscribe = engine.subscribe(() => {
        callCount++;
      });

      await mockProvider.append([
        {
          eventId: 'e1' as any,
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
      ]);

      await new Promise(resolve => setTimeout(resolve, 10));

      const countAfterFirst = callCount;
      unsubscribe();

      await mockProvider.append([
        {
          eventId: 'e2' as any,
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
      ]);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callCount).toBe(countAfterFirst);
    });
  });

  describe('validation', () => {
    test('validate returns empty array for valid state', async () => {
      await engine.initialize();
      const errors = engine.validate();
      expect(errors).toHaveLength(0);
    });
  });

  describe('snapshots', () => {
    test('can create and save snapshot', async () => {
      await engine.initialize();

      await mockProvider.append([
        {
          eventId: 'e1' as any,
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
      ]);

      await new Promise(resolve => setTimeout(resolve, 10));

      await engine.saveSnapshot();

      const loaded = await mockProvider.loadSnapshot();
      expect(loaded).toBeDefined();
      expect(loaded!.eventPosition).toBe(1);
      expect(loaded!.state.players[PlayerId('p1')]).toBeDefined();
    });
  });
});
