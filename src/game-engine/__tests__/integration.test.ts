/**
 * Integration Test - Game Engine
 * 
 * This test verifies that the game engine is properly integrated
 * with the existing codebase.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Doc } from 'yjs';
import { initializeGameEngine, teardownGameEngine } from '../../lib/gameEngineIntegration';
import { bridgeOldEventToNew, shouldBridgeEvent } from '../bridges/event-bridge';
import { PlayerId, CardId } from '../types';

describe('Game Engine Integration', () => {
  let ydoc: Doc;
  let engine: any;

  beforeEach(async () => {
    ydoc = new Doc();
    
    // Mock provider
    const mockProvider = {
      awareness: {
        clientID: 1,
        setLocalStateField: () => {},
      },
    } as any;

    engine = await initializeGameEngine(
      'test-game',
      'test-player',
      ydoc,
      mockProvider,
      null,
    );
  });

  afterEach(() => {
    teardownGameEngine();
  });

  test('engine initializes correctly', () => {
    expect(engine).toBeDefined();
    expect(engine.getState()).toBeDefined();
    expect(engine.getState().gameId).toBe('test-game');
  });

  test('engine state has correct structure', () => {
    const state = engine.getState();
    
    expect(state).toHaveProperty('version');
    expect(state).toHaveProperty('gameId');
    expect(state).toHaveProperty('sequence');
    expect(state).toHaveProperty('players');
    expect(state).toHaveProperty('cards');
    expect(state).toHaveProperty('zones');
    expect(state).toHaveProperty('rng');
  });

  test('event bridge converts tap event', () => {
    const oldEvent = {
      type: 'tap',
      clientID: 123,
      payload: {
        userData: {
          id: 'card-123',
          isTapped: true,
        },
      },
    };

    const newEvent = bridgeOldEventToNew(oldEvent as any, 1);
    
    expect(newEvent).toBeDefined();
    expect(newEvent?.type).toBe('CARD_TAPPED');
    expect(newEvent?.payload).toHaveProperty('cardId');
    expect(newEvent?.payload).toHaveProperty('tapped');
  });

  test('event bridge converts flip event', () => {
    const oldEvent = {
      type: 'flip',
      clientID: 123,
      payload: {
        userData: {
          id: 'card-456',
          isFlipped: true,
        },
      },
    };

    const newEvent = bridgeOldEventToNew(oldEvent as any, 1);
    
    expect(newEvent).toBeDefined();
    expect(newEvent?.type).toBe('CARD_FLIPPED');
    expect(newEvent?.payload).toHaveProperty('cardId');
    expect(newEvent?.payload).toHaveProperty('flipped');
  });

  test('event bridge converts join event', () => {
    const oldEvent = {
      type: 'join',
      clientID: 123,
      payload: {
        name: 'Alice',
        life: 20,
        commanderLife: 40,
        color: '#ff0000',
      },
    };

    const newEvent = bridgeOldEventToNew(oldEvent as any, 1);
    
    expect(newEvent).toBeDefined();
    expect(newEvent?.type).toBe('PLAYER_JOINED');
    expect(newEvent?.payload).toHaveProperty('playerId');
    expect(newEvent?.payload).toHaveProperty('name');
    expect(newEvent?.payload.name).toBe('Alice');
  });

  test('shouldBridgeEvent identifies bridgeable events', () => {
    expect(shouldBridgeEvent('tap')).toBe(true);
    expect(shouldBridgeEvent('flip')).toBe(true);
    expect(shouldBridgeEvent('join')).toBe(true);
    expect(shouldBridgeEvent('unknown')).toBe(false);
  });

  test('engine can dispatch commands', async () => {
    await engine.dispatch({
      type: 'JOIN_GAME',
      playerId: PlayerId('player-1'),
      payload: {
        name: 'Test Player',
        life: 20,
        commanderLife: 40,
        color: '#00ff00',
      },
    });

    // Give time for async processing
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = engine.getState();
    expect(state.sequence).toBeGreaterThan(0);
  });

  test('engine validates state correctly', () => {
    const errors = engine.validate();
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBe(0); // Should be valid initially
  });

  test('engine can subscribe to state changes', async () => {
    const stateChanges: any[] = [];
    
    const unsubscribe = engine.subscribe((state: any) => {
      stateChanges.push(state);
    });

    await engine.dispatch({
      type: 'JOIN_GAME',
      playerId: PlayerId('player-2'),
      payload: {
        name: 'Player 2',
        life: 20,
        commanderLife: 40,
        color: '#0000ff',
      },
    });

    // Give time for async processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(stateChanges.length).toBeGreaterThan(0);
    
    unsubscribe();
  });
});

describe('Game Engine Integration - RNG', () => {
  test('RNG is deterministic', () => {
    const { seededShuffle } = require('../rng');
    
    const deck = ['A', 'B', 'C', 'D', 'E'];
    const seed = 'test-seed';
    const counter = 1;

    const shuffle1 = seededShuffle(deck, seed, counter);
    const shuffle2 = seededShuffle(deck, seed, counter);

    expect(shuffle1).toEqual(shuffle2);
  });

  test('Different counters produce different shuffles', () => {
    const { seededShuffle } = require('../rng');
    
    const deck = ['A', 'B', 'C', 'D', 'E'];
    const seed = 'test-seed';

    const shuffle1 = seededShuffle(deck, seed, 1);
    const shuffle2 = seededShuffle(deck, seed, 2);

    expect(shuffle1).not.toEqual(shuffle2);
  });
});
