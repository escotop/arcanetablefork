/**
 * Core types for the game engine.
 * These types are completely independent of Three.js, Yjs, or any UI framework.
 */

// Brand types for type safety
export type PlayerId = string & { readonly __brand: 'PlayerId' };
export type CardId = string & { readonly __brand: 'CardId' };
export type ZoneId = string & { readonly __brand: 'ZoneId' };
export type EventId = string & { readonly __brand: 'EventId' };

export function PlayerId(id: string): PlayerId {
  return id as PlayerId;
}

export function CardId(id: string): CardId {
  return id as CardId;
}

export function ZoneId(id: string): ZoneId {
  return id as ZoneId;
}

export function EventId(id: string): EventId {
  return id as EventId;
}

// ============================================================================
// Game State
// ============================================================================

export interface GameState {
  readonly version: number;
  readonly gameId: string;
  readonly sequence: number; // Último evento aplicado
  readonly players: Record<PlayerId, PlayerState>;
  readonly cards: Record<CardId, CardState>;
  readonly zones: Record<ZoneId, ZoneState>;
  readonly turn: TurnState;
  readonly stack: StackItem[];
  readonly counters: Record<string, CounterDefinition>;
  readonly rng: RNGState;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly life: number;
  readonly commanderLife: number;
  readonly commanderDamage: Record<PlayerId, number>;
  readonly color: string;
  readonly counters: Record<string, number>;
  readonly isActive: boolean;
  readonly hasPriority: boolean;
}

export type ZoneType = 
  | 'deck'
  | 'hand' 
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command'
  | 'stack'
  | 'peek'
  | 'reveal'
  | 'tokenSearch';

export interface ZoneState {
  readonly id: ZoneId;
  readonly type: ZoneType;
  readonly ownerId: PlayerId;
  readonly cardIds: readonly CardId[];
  readonly isPublic: boolean;
  readonly isOrdered: boolean;
}

export interface CardState {
  readonly id: CardId;
  readonly ownerId: PlayerId;
  readonly zoneId: ZoneId;
  
  // Card identity
  readonly name: string;
  readonly oracleId?: string;
  readonly scryfallId?: string;
  readonly set?: string;
  readonly collectorNumber?: string;
  
  // State
  readonly tapped: boolean;
  readonly flipped: boolean;
  readonly faceDown: boolean;
  readonly phased: boolean;
  
  // Position (for zones that care)
  readonly position?: Position3D;
  readonly rotation?: Rotation3D;
  
  // Modifiers
  readonly counters: Record<string, number>;
  readonly powerModifier: number;
  readonly toughnessModifier: number;
  
  // Attachments
  readonly attachedTo?: CardId;
  readonly attachedCards: readonly CardId[];
  
  // Metadata
  readonly isToken: boolean;
  readonly isClone: boolean;
  readonly clonedFrom?: CardId;
  readonly customArtUrl?: string;
}

export interface Position3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Rotation3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TurnState {
  readonly number: number;
  readonly phase: Phase;
  readonly step: Step | null;
  readonly activePlayerId: PlayerId;
  readonly priorityPlayerId: PlayerId | null;
  readonly turnOrder: readonly PlayerId[];
}

export type Phase = 
  | 'beginning'
  | 'precombat_main'
  | 'combat'
  | 'postcombat_main'
  | 'ending';

export type Step =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'declare_attackers'
  | 'declare_blockers'
  | 'combat_damage'
  | 'end_of_combat'
  | 'end'
  | 'cleanup';

export interface StackItem {
  readonly id: string;
  readonly cardId?: CardId;
  readonly source: PlayerId;
  readonly type: 'spell' | 'ability' | 'trigger';
}

export interface CounterDefinition {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface RNGState {
  readonly seed: string;
  readonly counter: number;
}

// ============================================================================
// Events
// ============================================================================

export interface GameEvent<T = unknown> {
  readonly eventId: EventId;
  readonly sequence: number;
  readonly timestamp: number;
  readonly playerId: PlayerId;
  readonly type: GameEventType;
  readonly payload: T;
}

export type GameEventType =
  // Player events
  | 'PLAYER_JOINED'
  | 'PLAYER_LEFT'
  | 'PLAYER_LIFE_CHANGED'
  | 'PLAYER_COUNTER_CHANGED'
  
  // Card events
  | 'CARD_CREATED'
  | 'CARD_MOVED'
  | 'CARD_TAPPED'
  | 'CARD_FLIPPED'
  | 'CARD_FACE_CHANGED'
  | 'CARD_COUNTER_CHANGED'
  | 'CARD_POWER_MODIFIED'
  | 'CARD_TOUGHNESS_MODIFIED'
  | 'CARD_ATTACHED'
  | 'CARD_DETACHED'
  | 'CARD_DESTROYED'
  
  // Zone events
  | 'ZONE_CREATED'
  | 'ZONE_SHUFFLED'
  | 'ZONE_REVEALED'
  | 'ZONE_PEEKED'
  
  // Turn events
  | 'TURN_STARTED'
  | 'PHASE_CHANGED'
  | 'STEP_CHANGED'
  | 'PRIORITY_PASSED'
  
  // Game events
  | 'GAME_STARTED'
  | 'COUNTER_DEFINED'
  | 'RNG_ADVANCED';

// Event payloads
export interface PlayerJoinedPayload {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly life: number;
  readonly commanderLife: number;
  readonly color: string;
}

export interface PlayerLifeChangedPayload {
  readonly playerId: PlayerId;
  readonly delta: number;
  readonly newLife: number;
  readonly source?: CardId;
}

export interface CardCreatedPayload {
  readonly cardId: CardId;
  readonly ownerId: PlayerId;
  readonly zoneId: ZoneId;
  readonly name: string;
  readonly scryfallId?: string;
  readonly isToken?: boolean;
  readonly position?: Position3D;
}

export interface CardMovedPayload {
  readonly cardId: CardId;
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  readonly position?: Position3D;
  readonly index?: number;
  readonly faceDown?: boolean;
}

export interface CardTappedPayload {
  readonly cardId: CardId;
  readonly tapped: boolean;
}

export interface CardFlippedPayload {
  readonly cardId: CardId;
  readonly flipped: boolean;
}

export interface CardCounterChangedPayload {
  readonly cardId: CardId;
  readonly counterId: string;
  readonly delta: number;
  readonly newValue: number;
}

export interface ZoneShuffledPayload {
  readonly zoneId: ZoneId;
  readonly rngCounter: number;
  readonly newOrder: readonly CardId[];
}

// ============================================================================
// Commands
// ============================================================================

export interface GameCommand<T = unknown> {
  readonly type: GameCommandType;
  readonly playerId: PlayerId;
  readonly payload: T;
}

export type GameCommandType =
  | 'JOIN_GAME'
  | 'TAP_CARD'
  | 'UNTAP_CARD'
  | 'FLIP_CARD'
  | 'MOVE_CARD'
  | 'ADD_COUNTER'
  | 'REMOVE_COUNTER'
  | 'SHUFFLE_ZONE'
  | 'DRAW_CARD'
  | 'PLAY_CARD'
  | 'PASS_PRIORITY';

// ============================================================================
// Snapshots
// ============================================================================

export interface GameSnapshot {
  readonly schemaVersion: number;
  readonly eventPosition: number;
  readonly timestamp: number;
  readonly state: GameState;
}

// ============================================================================
// Sync Provider Interface
// ============================================================================

export type EventCallback = (events: readonly GameEvent[]) => void;
export type Unsubscribe = () => void;

export interface GameSyncProvider {
  append(events: readonly GameEvent[]): Promise<void>;
  subscribe(callback: EventCallback): Unsubscribe;
  getEvents(fromSequence: number): Promise<readonly GameEvent[]>;
  saveSnapshot(snapshot: GameSnapshot): Promise<void>;
  loadSnapshot(): Promise<GameSnapshot | null>;
  getLatestSequence(): Promise<number>;
}
