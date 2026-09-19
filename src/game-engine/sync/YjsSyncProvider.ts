/**
 * Yjs implementation of GameSyncProvider
 * 
 * Bridges the game engine with Yjs for network synchronization
 */

import { Doc } from 'yjs';
import { YArray, YMap } from 'yjs/dist/src/internals';
import type { WebsocketProvider } from 'y-websocket';
import type { WebrtcProvider } from 'y-webrtc';
import type { IndexeddbPersistence } from 'y-indexeddb';
import {
  GameSyncProvider,
  GameEvent,
  GameSnapshot,
  EventCallback,
  Unsubscribe,
} from '../types';

export interface YjsSyncProviderConfig {
  gameId: string;
  ydoc?: Doc;
  provider?: WebsocketProvider | WebrtcProvider;
  persistence?: IndexeddbPersistence;
}

export class YjsSyncProvider implements GameSyncProvider {
  private readonly config: YjsSyncProviderConfig;
  private readonly ydoc: Doc;
  private readonly eventLog: YArray<unknown>;
  private readonly snapshotMap: YMap<unknown>;
  private readonly callbacks: Set<EventCallback> = new Set();
  private lastProcessedIndex = 0;

  constructor(config: YjsSyncProviderConfig) {
    this.config = config;
    this.ydoc = config.ydoc ?? new Doc();
    this.eventLog = this.ydoc.getArray('gameEngine:events');
    this.snapshotMap = this.ydoc.getMap('gameEngine:snapshots');

    // Subscribe to event log changes
    this.eventLog.observe(() => {
      this.processNewEvents();
    });
  }

  async append(events: readonly GameEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Wrap in Yjs transaction for atomic update
    this.ydoc.transact(() => {
      // Serialize events for Yjs
      const serialized = events.map(e => this.serializeEvent(e));
      this.eventLog.push(serialized);
    });
  }

  subscribe(callback: EventCallback): Unsubscribe {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  async getEvents(fromSequence: number): Promise<readonly GameEvent[]> {
    const events: GameEvent[] = [];
    
    for (let i = 0; i < this.eventLog.length; i++) {
      const raw = this.eventLog.get(i);
      const event = this.deserializeEvent(raw);
      
      if (event && event.sequence >= fromSequence) {
        events.push(event);
      }
    }

    return events;
  }

  async saveSnapshot(snapshot: GameSnapshot): Promise<void> {
    this.ydoc.transact(() => {
      const key = `snapshot:${snapshot.eventPosition}`;
      this.snapshotMap.set(key, this.serializeSnapshot(snapshot));
      
      // Also save as "latest"
      this.snapshotMap.set('snapshot:latest', this.serializeSnapshot(snapshot));
    });
  }

  async loadSnapshot(): Promise<GameSnapshot | null> {
    const raw = this.snapshotMap.get('snapshot:latest');
    if (!raw) return null;
    
    return this.deserializeSnapshot(raw);
  }

  async getLatestSequence(): Promise<number> {
    if (this.eventLog.length === 0) return 0;
    
    const lastEvent = this.eventLog.get(this.eventLog.length - 1);
    const deserialized = this.deserializeEvent(lastEvent);
    return deserialized?.sequence ?? 0;
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private processNewEvents(): void {
    const events: GameEvent[] = [];
    
    for (let i = this.lastProcessedIndex; i < this.eventLog.length; i++) {
      const raw = this.eventLog.get(i);
      const event = this.deserializeEvent(raw);
      
      if (event) {
        events.push(event);
      }
    }

    this.lastProcessedIndex = this.eventLog.length;

    if (events.length > 0) {
      this.callbacks.forEach(callback => {
        try {
          callback(events);
        } catch (error) {
          console.error('Error in sync callback:', error);
        }
      });
    }
  }

  private serializeEvent(event: GameEvent): unknown {
    // Create a clean object without circular references
    return {
      eventId: event.eventId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      playerId: event.playerId,
      type: event.type,
      payload: this.sanitizePayload(event.payload),
    };
  }

  private deserializeEvent(raw: unknown): GameEvent | null {
    if (!raw || typeof raw !== 'object') return null;
    
    const obj = raw as Record<string, unknown>;
    
    return {
      eventId: obj.eventId as string,
      sequence: obj.sequence as number,
      timestamp: obj.timestamp as number,
      playerId: obj.playerId as string,
      type: obj.type as string,
      payload: obj.payload,
    } as GameEvent;
  }

  private serializeSnapshot(snapshot: GameSnapshot): unknown {
    return {
      schemaVersion: snapshot.schemaVersion,
      eventPosition: snapshot.eventPosition,
      timestamp: snapshot.timestamp,
      state: this.sanitizePayload(snapshot.state),
    };
  }

  private deserializeSnapshot(raw: unknown): GameSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    
    const obj = raw as Record<string, unknown>;
    
    return {
      schemaVersion: obj.schemaVersion as number,
      eventPosition: obj.eventPosition as number,
      timestamp: obj.timestamp as number,
      state: obj.state as any,
    };
  }

  private sanitizePayload(payload: unknown): unknown {
    // Remove any non-serializable data
    if (payload === null || payload === undefined) return payload;
    if (typeof payload !== 'object') return payload;
    
    if (Array.isArray(payload)) {
      return payload.map(item => this.sanitizePayload(item));
    }
    
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(payload)) {
      // Skip functions, symbols, and Three.js objects
      if (typeof value === 'function') continue;
      if (typeof value === 'symbol') continue;
      if (value && typeof value === 'object' && ('isObject3D' in value || 'isMaterial' in value)) {
        continue;
      }
      
      result[key] = this.sanitizePayload(value);
    }
    
    return result;
  }
}

/**
 * Helper to create a YjsSyncProvider from existing globals
 */
export function createYjsSyncProviderFromGlobals(
  gameId: string,
  ydoc: Doc,
  provider?: WebsocketProvider | WebrtcProvider,
  persistence?: IndexeddbPersistence,
): YjsSyncProvider {
  return new YjsSyncProvider({
    gameId,
    ydoc,
    provider,
    persistence,
  });
}
