/**
 * GameEngine: Main coordination layer
 * 
 * Responsibilities:
 * - Convert commands to events
 * - Apply events through reducer
 * - Coordinate with sync provider
 * - Manage subscriptions
 * - Handle snapshots
 */

import { nanoid } from 'nanoid';
import {
  GameState,
  GameEvent,
  GameCommand,
  GameSnapshot,
  GameSyncProvider,
  EventCallback,
  Unsubscribe,
  PlayerId,
  CardId,
  ZoneId,
  EventId,
  CardTappedPayload,
  CardFlippedPayload,
  CardMovedPayload,
  CardCounterChangedPayload,
  PlayerJoinedPayload,
  ZoneShuffledPayload,
} from './types';
import { reduce, createEmptyGameState, validateState } from './reducer';
import { seededShuffle } from './rng';

export interface GameEngineConfig {
  gameId: string;
  playerId: PlayerId;
  syncProvider: GameSyncProvider;
  onStateChange?: (state: GameState) => void;
  onError?: (error: Error) => void;
}

export class GameEngine {
  private state: GameState;
  private readonly config: GameEngineConfig;
  private readonly subscribers: Set<(state: GameState) => void> = new Set();
  private syncUnsubscribe?: Unsubscribe;
  private isApplyingEvents = false;

  constructor(config: GameEngineConfig) {
    this.config = config;
    this.state = createEmptyGameState(config.gameId, nanoid());
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async initialize(): Promise<void> {
    // Try to load snapshot
    const snapshot = await this.config.syncProvider.loadSnapshot();
    
    if (snapshot) {
      this.state = snapshot.state;
      
      // Replay events after snapshot
      const events = await this.config.syncProvider.getEvents(snapshot.eventPosition + 1);
      if (events.length > 0) {
        this.applyEvents(events);
      }
    } else {
      // Get all events from beginning
      const events = await this.config.syncProvider.getEvents(0);
      if (events.length > 0) {
        this.applyEvents(events);
      }
    }

    // Subscribe to new events
    this.syncUnsubscribe = this.config.syncProvider.subscribe((events) => {
      this.applyEvents(events);
    });

    this.notifyStateChange();
  }

  destroy(): void {
    this.syncUnsubscribe?.();
    this.subscribers.clear();
  }

  // ============================================================================
  // State access
  // ============================================================================

  getState(): Readonly<GameState> {
    return this.state;
  }

  subscribe(callback: (state: GameState) => void): Unsubscribe {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // ============================================================================
  // Commands → Events
  // ============================================================================

  async dispatch(command: GameCommand): Promise<void> {
    const events = this.commandToEvents(command);
    
    if (events.length === 0) {
      return;
    }

    // Optimistic update (optional, can be disabled)
    // this.applyEvents(events);

    // Sync to network
    await this.config.syncProvider.append(events);
  }

  private commandToEvents(command: GameCommand): GameEvent[] {
    const baseEvent = {
      eventId: EventId(nanoid()),
      sequence: this.state.sequence + 1,
      timestamp: Date.now(),
      playerId: command.playerId,
    };

    switch (command.type) {
      case 'JOIN_GAME': {
        const payload = command.payload as {
          name: string;
          life: number;
          commanderLife: number;
          color: string;
        };
        return [
          {
            ...baseEvent,
            type: 'PLAYER_JOINED',
            payload: {
              playerId: command.playerId,
              ...payload,
            } as PlayerJoinedPayload,
          },
        ];
      }

      case 'TAP_CARD': {
        const { cardId } = command.payload as { cardId: CardId };
        const card = this.state.cards[cardId];
        if (!card) {
          console.warn('Card not found:', cardId);
          return [];
        }

        return [
          {
            ...baseEvent,
            type: 'CARD_TAPPED',
            payload: {
              cardId,
              tapped: !card.tapped,
            } as CardTappedPayload,
          },
        ];
      }

      case 'UNTAP_CARD': {
        const { cardId } = command.payload as { cardId: CardId };
        return [
          {
            ...baseEvent,
            type: 'CARD_TAPPED',
            payload: {
              cardId,
              tapped: false,
            } as CardTappedPayload,
          },
        ];
      }

      case 'FLIP_CARD': {
        const { cardId } = command.payload as { cardId: CardId };
        const card = this.state.cards[cardId];
        if (!card) {
          console.warn('Card not found:', cardId);
          return [];
        }

        return [
          {
            ...baseEvent,
            type: 'CARD_FLIPPED',
            payload: {
              cardId,
              flipped: !card.flipped,
            } as CardFlippedPayload,
          },
        ];
      }

      case 'MOVE_CARD': {
        const payload = command.payload as {
          cardId: CardId;
          fromZoneId: ZoneId;
          toZoneId: ZoneId;
          position?: { x: number; y: number; z: number };
          index?: number;
          faceDown?: boolean;
        };

        return [
          {
            ...baseEvent,
            type: 'CARD_MOVED',
            payload,
          },
        ];
      }

      case 'ADD_COUNTER': {
        const { cardId, counterId } = command.payload as {
          cardId: CardId;
          counterId: string;
        };
        const card = this.state.cards[cardId];
        if (!card) return [];

        const currentValue = card.counters[counterId] ?? 0;
        const newValue = currentValue + 1;

        return [
          {
            ...baseEvent,
            type: 'CARD_COUNTER_CHANGED',
            payload: {
              cardId,
              counterId,
              delta: 1,
              newValue,
            } as CardCounterChangedPayload,
          },
        ];
      }

      case 'REMOVE_COUNTER': {
        const { cardId, counterId } = command.payload as {
          cardId: CardId;
          counterId: string;
        };
        const card = this.state.cards[cardId];
        if (!card) return [];

        const currentValue = card.counters[counterId] ?? 0;
        if (currentValue <= 0) return [];

        const newValue = currentValue - 1;

        return [
          {
            ...baseEvent,
            type: 'CARD_COUNTER_CHANGED',
            payload: {
              cardId,
              counterId,
              delta: -1,
              newValue,
            } as CardCounterChangedPayload,
          },
        ];
      }

      case 'SHUFFLE_ZONE': {
        const { zoneId } = command.payload as { zoneId: ZoneId };
        const zone = this.state.zones[zoneId];
        if (!zone) return [];

        const rngCounter = this.state.rng.counter + 1;
        const newOrder = seededShuffle(
          zone.cardIds,
          this.state.rng.seed,
          rngCounter,
        );

        return [
          {
            ...baseEvent,
            type: 'ZONE_SHUFFLED',
            payload: {
              zoneId,
              rngCounter,
              newOrder,
            } as ZoneShuffledPayload,
          },
        ];
      }

      default:
        console.warn('Unhandled command type:', command.type);
        return [];
    }
  }

  // ============================================================================
  // Event application
  // ============================================================================

  /**
   * Apply events locally without syncing (shadow mode / event bridge from legacy system).
   */
  applyShadowEvents(events: readonly GameEvent[]): void {
    this.applyEvents(events);
  }

  private applyEvents(events: readonly GameEvent[]): void {
    if (this.isApplyingEvents) {
      console.warn('Recursive event application detected');
      return;
    }

    this.isApplyingEvents = true;

    try {
      let newState = this.state;

      for (const event of events) {
        // Skip events we've already processed
        if (event.sequence <= newState.sequence) {
          continue;
        }

        newState = reduce(newState, event);
      }

      if (newState !== this.state) {
        this.state = newState;
        this.notifyStateChange();
      }
    } catch (error) {
      this.config.onError?.(error as Error);
      console.error('Error applying events:', error);
    } finally {
      this.isApplyingEvents = false;
    }
  }

  private notifyStateChange(): void {
    this.config.onStateChange?.(this.state);
    this.subscribers.forEach(callback => {
      try {
        callback(this.state);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    });
  }

  // ============================================================================
  // Snapshots
  // ============================================================================

  async createSnapshot(): Promise<GameSnapshot> {
    return {
      schemaVersion: 1,
      eventPosition: this.state.sequence,
      timestamp: Date.now(),
      state: this.state,
    };
  }

  async saveSnapshot(): Promise<void> {
    const snapshot = await this.createSnapshot();
    await this.config.syncProvider.saveSnapshot(snapshot);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  validate(): string[] {
    return validateState(this.state);
  }

  /**
   * Get a read-only view of a specific card
   */
  getCard(cardId: CardId) {
    return this.state.cards[cardId];
  }

  /**
   * Get a read-only view of a specific zone
   */
  getZone(zoneId: ZoneId) {
    return this.state.zones[zoneId];
  }

  /**
   * Get a read-only view of a specific player
   */
  getPlayer(playerId: PlayerId) {
    return this.state.players[playerId];
  }

  /**
   * Get all cards in a zone
   */
  getCardsInZone(zoneId: ZoneId) {
    const zone = this.state.zones[zoneId];
    if (!zone) return [];
    
    return zone.cardIds
      .map(id => this.state.cards[id])
      .filter(Boolean);
  }
}
