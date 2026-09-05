import * as Sentry from '@sentry/solidstart';
import { processEvents } from '../remoteEvents';
import {
  gameLog,
  gameState,
  provider,
  sendEvent,
  setIsIntitialized,
  setLocalPlayerClientId,
  setProcessedEvents,
  setGameStateImportInProgress,
  setEventCatchUpComplete,
  finishHistoricalLogReplay,
  playAreas,
  resetGameSceneForReplay,
} from './globals';
import { devLog } from './devLog';
import { readjustPlayAreas } from '../main3d';
import {
  findJoinClientIdForSession,
  getOrCreatePlayerSessionId,
  getStoredJoinBinding,
  persistJoinBinding,
  registerPlayerSession,
} from './playerSession';
import { setCounters } from './ui/counterDialog';
import { syncLocalPlayerColor } from './playerColor';

export const GAME_STATE_SNAPSHOT_VERSION = 1;

export interface PlayerAwarenessSnapshot {
  clientId: number;
  playerSessionId?: string;
  name?: string;
  life?: number;
  commanderLife?: number;
  color?: string;
  counters?: Record<string, number>;
  isSpectating?: boolean;
}

export interface GameStateSnapshot {
  version: number;
  exportedAt: string;
  gameId?: string;
  gameLog: unknown[];
  gameState: Record<string, unknown>;
  players: PlayerAwarenessSnapshot[];
}

let lastSeenImportVersion: number | undefined;
let importInProgress = false;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function serializeGameLog(): unknown[] {
  const events: unknown[] = [];
  for (let i = 0; i < gameLog.length; i++) {
    events.push(gameLog.get(i));
  }
  return cloneJson(events);
}

function serializeGameStateMap(): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  gameState.forEach((value, key) => {
    state[key] = value;
  });
  return cloneJson(state);
}

function capturePlayerAwareness(): PlayerAwarenessSnapshot[] {
  if (!provider?.awareness) return [];

  return Array.from(provider.awareness.getStates().entries()).map(([clientId, entry]) => ({
    clientId,
    playerSessionId: entry.playerSessionId,
    name: entry.name,
    life: entry.life,
    commanderLife: entry.commanderLife,
    color: entry.color,
    counters: entry.counters ? { ...entry.counters } : undefined,
    isSpectating: entry.isSpectating,
  }));
}

export function exportGameState(gameId?: string): GameStateSnapshot {
  const players = capturePlayerAwareness();
  const serializedState = serializeGameStateMap();

  return {
    version: GAME_STATE_SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    gameId,
    gameLog: serializeGameLog(),
    gameState: {
      ...serializedState,
      playerAwareness: players,
    },
    players,
  };
}

export function downloadGameStateExport(gameId?: string) {
  const snapshot = exportGameState(gameId);
  const stamp = snapshot.exportedAt.replace(/[:.]/g, '-');
  const filename = `arcanetable-${gameId ?? 'game'}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseGameStateSnapshot(raw: unknown): GameStateSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid game state file.');
  }

  const snapshot = raw as Partial<GameStateSnapshot>;
  if (snapshot.version !== GAME_STATE_SNAPSHOT_VERSION) {
    throw new Error('Unsupported game state version.');
  }
  if (!Array.isArray(snapshot.gameLog)) {
    throw new Error('Game state file is missing the event log.');
  }

  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  const state = snapshot.gameState && typeof snapshot.gameState === 'object' ? snapshot.gameState : {};

  return {
    version: GAME_STATE_SNAPSHOT_VERSION,
    exportedAt: snapshot.exportedAt ?? new Date().toISOString(),
    gameId: snapshot.gameId,
    gameLog: cloneJson(snapshot.gameLog),
    gameState: cloneJson(state),
    players: cloneJson(players),
  };
}

function restoreLocalAwareness(snapshots: PlayerAwarenessSnapshot[], gameId: string) {
  if (!provider?.awareness || snapshots.length === 0) return;

  const playerSessionId = getOrCreatePlayerSessionId(gameId);
  const joinClientId =
    findJoinClientIdForSession(gameLog, playerSessionId) ?? getStoredJoinBinding(gameId)?.clientId;

  let snapshot =
    snapshots.find(player => player.playerSessionId === playerSessionId) ??
    (joinClientId !== undefined
      ? snapshots.find(player => player.clientId === joinClientId)
      : undefined);

  if (!snapshot) return;

  const localState = provider.awareness.getLocalState() ?? {};
  provider.awareness.setLocalState({
    ...localState,
    playerSessionId,
    name: snapshot.name ?? localState.name,
    life: snapshot.life ?? localState.life,
    commanderLife: snapshot.commanderLife ?? localState.commanderLife,
    color: snapshot.color ?? localState.color,
    counters: snapshot.counters ?? localState.counters,
    isSpectating: snapshot.isSpectating ?? localState.isSpectating,
  });

  if (snapshot.color) {
    syncLocalPlayerColor(snapshot.color);
  }
}

async function reconnectLocalPlayArea(gameId: string) {
  const playerSessionId = getOrCreatePlayerSessionId(gameId);
  const joinClientId =
    findJoinClientIdForSession(gameLog, playerSessionId) ?? getStoredJoinBinding(gameId)?.clientId;

  if (joinClientId === undefined) return;

  const area = playAreas[joinClientId];
  if (!area) return;

  area.setAsLocalPlayArea();
  area.subscribeEvents(sendEvent);
  setLocalPlayerClientId(joinClientId);
  registerPlayerSession(playerSessionId, joinClientId);
  persistJoinBinding(gameId, { playerSessionId, clientId: joinClientId });
  setIsIntitialized(true);
  readjustPlayAreas();
  void area.loadTextures();
  setEventCatchUpComplete(true);
  finishHistoricalLogReplay();
}

async function finalizeAfterReplay(gameId: string) {
  const snapshots =
    (gameState.get('playerAwareness') as PlayerAwarenessSnapshot[] | undefined) ?? [];
  if (snapshots.length > 0) {
    restoreLocalAwareness(snapshots, gameId);
  }
  await reconnectLocalPlayArea(gameId);
}

async function applyGameStateSnapshot(snapshot: GameStateSnapshot, gameId: string) {
  setGameStateImportInProgress(true);
  try {
    resetGameSceneForReplay();
    setCounters([]);

    const players = snapshot.players.length > 0 ? snapshot.players : snapshot.gameState.playerAwareness;
    const nextGameState = {
      ...snapshot.gameState,
      playerAwareness: players,
      importVersion: Date.now(),
    };

    gameLog.doc.transact(() => {
      if (gameLog.length > 0) {
        gameLog.delete(0, gameLog.length);
      }
      snapshot.gameLog.forEach(event => gameLog.push([cloneJson(event)]));

      Array.from(gameState.keys()).forEach(key => gameState.delete(key));
      Object.entries(nextGameState).forEach(([key, value]) => gameState.set(key, value));
    });

    setProcessedEvents(0);
    await processEvents();
    Object.values(playAreas).forEach(area => area?.reapplyBattlefieldOrientations());
    await finalizeAfterReplay(gameId);
    lastSeenImportVersion = nextGameState.importVersion as number;
  } finally {
    setGameStateImportInProgress(false);
  }
}

async function handleRemoteGameStateImport(gameId: string) {
  if (importInProgress) return;

  setGameStateImportInProgress(true);
  try {
    resetGameSceneForReplay();
    setCounters([]);
    setProcessedEvents(0);
    await processEvents();
    Object.values(playAreas).forEach(area => area?.reapplyBattlefieldOrientations());
    await finalizeAfterReplay(gameId);
  } finally {
    setGameStateImportInProgress(false);
  }
}

export async function importGameState(snapshot: GameStateSnapshot, gameId: string) {
  importInProgress = true;
  try {
    await applyGameStateSnapshot(snapshot, gameId);
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  } finally {
    importInProgress = false;
  }
}

export function setupGameStateImportObserver(getGameId: () => string | undefined) {
  lastSeenImportVersion = gameState.get('importVersion') as number | undefined;

  gameState.observe(() => {
    const version = gameState.get('importVersion') as number | undefined;
    if (version === undefined || version === lastSeenImportVersion) return;

    lastSeenImportVersion = version;
    const gameId = getGameId();
    if (!gameId) return;

    void handleRemoteGameStateImport(gameId).catch(error => {
      Sentry.captureException(error);
      devLog.error(error);
    });
  });
}
