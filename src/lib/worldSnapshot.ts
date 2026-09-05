import { nanoid } from 'nanoid';
import {
  gameLog,
  gameState,
  playAreas,
  players,
  provider,
  resetGameSceneForReplay,
  sendEvent,
  setEventCatchUpComplete,
  setIsIntitialized,
  setLocalPlayerClientId,
  setPlayAreas,
  setPlayerCount,
  setProcessedEvents,
  setSyncPaused,
  table,
  flushDispatchEventQueue,
  isSyncPaused,
  processedEvents,
} from './globals';
import { readjustPlayAreas } from '../main3d';
import { PlayArea } from './playArea';
import type { PlayerAwarenessSnapshot } from './gameStateSnapshot';
import { syncLocalPlayerColor } from './playerColor';
import {
  findJoinClientIdForSession,
  getOrCreatePlayerSessionId,
  getStoredJoinBinding,
  persistJoinBinding,
  registerPlayerSession,
} from './playerSession';
import { getActiveJoinClientIdsFromLog } from '../remoteEvents';
import { setCounters } from './ui/counterDialog';
import { refreshMultiplayerSyncState } from './multiplayerSync';

export const WORLD_SNAPSHOT_VERSION = 1;

export interface SyncBarrier {
  id: string;
  joinerSessionId: string;
  status: 'pending' | 'ready' | 'released';
  requestedAt: number;
  snapshotVersion?: number;
  hostClientId?: number;
}

export interface WorldSnapshotPlayArea {
  clientId: number;
  playerSessionId?: string;
  state: ReturnType<PlayArea['getLocalState']>;
}

export interface WorldSnapshot {
  version: number;
  snapshotVersion: number;
  barrierId: string;
  exportedAt: string;
  logLength: number;
  playAreas: WorldSnapshotPlayArea[];
  players: PlayerAwarenessSnapshot[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
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

export function isSyncHost(): boolean {
  if (!provider?.awareness) return true;
  const localId = provider.awareness.clientID;
  const candidates = Array.from(provider.awareness.getStates().entries()).filter(
    ([, entry]) => !entry?.isSpectating,
  );
  if (!candidates.length) return true;
  const hostId = Math.min(...candidates.map(([id]) => Number(id)));
  return Number(localId) === hostId;
}

export function gameNeedsSnapshotSync(playerSessionId: string): boolean {
  if (!gameLog?.length) return false;
  if (getActiveJoinClientIdsFromLog().size === 0) return false;

  const existingJoin = findJoinClientIdForSession(gameLog, playerSessionId);
  if (existingJoin !== undefined) return true;

  const remoteOnline = players().filter(
    player => player.id !== provider?.awareness?.clientID && !player.entry?.isSpectating,
  );
  return remoteOnline.length > 0;
}

export function exportWorldSnapshot(barrierId: string): WorldSnapshot {
  const playAreaEntries: WorldSnapshotPlayArea[] = Object.values(playAreas)
    .filter(Boolean)
    .map(area => ({
      clientId: area.clientId,
      playerSessionId: area.playerSessionId,
      state: cloneJson(area.getLocalState()),
    }));

  return {
    version: WORLD_SNAPSHOT_VERSION,
    snapshotVersion: Date.now(),
    barrierId,
    exportedAt: new Date().toISOString(),
    logLength: gameLog.length,
    playAreas: playAreaEntries,
    players: capturePlayerAwareness(),
  };
}

function restorePlayerAwareness(snapshots: PlayerAwarenessSnapshot[], gameId: string) {
  if (!provider?.awareness || snapshots.length === 0) return;

  const playerSessionId = getOrCreatePlayerSessionId(gameId);
  const joinClientId =
    findJoinClientIdForSession(gameLog, playerSessionId) ?? getStoredJoinBinding(gameId)?.clientId;

  const snapshot =
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

export async function applyWorldSnapshot(
  gameId: string,
  playerSessionId: string,
  snapshot: WorldSnapshot,
) {
  resetGameSceneForReplay();
  setCounters([]);

  const joinClientId =
    findJoinClientIdForSession(gameLog, playerSessionId) ?? getStoredJoinBinding(gameId)?.clientId;

  let localArea: PlayArea | undefined;

  for (const entry of snapshot.playAreas) {
    const isSelf =
      entry.playerSessionId === playerSessionId ||
      (joinClientId !== undefined && entry.clientId === joinClientId);

    const area = PlayArea.fromWorldSnapshot(entry.clientId, entry.state, {
      isLocalPlayer: isSelf,
    });
    area.playerSessionId = entry.playerSessionId;
    area.index = entry.state.index ?? 0;

    setPlayAreas(entry.clientId, area);
    table.add(area.mesh);

    if (entry.playerSessionId) {
      registerPlayerSession(entry.playerSessionId, entry.clientId);
    }

    if (isSelf) {
      localArea = area;
    }
  }

  setPlayerCount(snapshot.playAreas.length);
  restorePlayerAwareness(snapshot.players, gameId);

  setProcessedEvents(gameLog.length);
  readjustPlayAreas();

  if (localArea) {
    localArea.setAsLocalPlayArea();
    localArea.subscribeEvents(sendEvent);
    setLocalPlayerClientId(localArea.clientId);
    persistJoinBinding(gameId, { playerSessionId, clientId: localArea.clientId });
    setIsIntitialized(true);
    void localArea.loadTextures();
  }

  setEventCatchUpComplete(true);
}

async function waitForBarrierSnapshot(barrierId: string, maxWaitMs: number): Promise<WorldSnapshot> {
  const deadline = performance.now() + maxWaitMs;

  while (performance.now() < deadline) {
    const barrier = gameState.get('syncBarrier') as SyncBarrier | undefined;
    const snapshot = gameState.get('worldSnapshot') as WorldSnapshot | undefined;

    if (barrier?.id === barrierId && barrier.status === 'ready' && snapshot?.barrierId === barrierId) {
      return snapshot;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for world snapshot');
}

function releaseSyncBarrier(barrierId: string) {
  gameState.doc?.transact(() => {
    const current = gameState.get('syncBarrier') as SyncBarrier | undefined;
    if (current?.id !== barrierId) return;
    gameState.set('syncBarrier', { ...current, status: 'released' });
  });

  window.setTimeout(() => {
    gameState.doc?.transact(() => {
      const current = gameState.get('syncBarrier') as SyncBarrier | undefined;
      if (current?.id !== barrierId) return;
      gameState.delete('syncBarrier');
      gameState.delete('worldSnapshot');
    });
  }, 300);
}

function publishSnapshotForBarrier(barrier: SyncBarrier) {
  if (!isSyncHost() || barrier.status !== 'pending') return;
  if (isSyncPaused() && (gameState.get('worldSnapshot') as WorldSnapshot | undefined)?.barrierId === barrier.id) {
    return;
  }

  void flushDispatchEventQueue().then(() => {
    const snapshot = exportWorldSnapshot(barrier.id);
    gameState.doc?.transact(() => {
      const current = gameState.get('syncBarrier') as SyncBarrier | undefined;
      if (current?.id !== barrier.id || current.status !== 'pending') return;
      gameState.set('worldSnapshot', snapshot);
      gameState.set('syncBarrier', {
        ...current,
        status: 'ready',
        snapshotVersion: snapshot.snapshotVersion,
        hostClientId: provider?.awareness?.clientID,
      });
    });
  });
}

let lastObservedBarrier: SyncBarrier | undefined = gameState?.get?.('syncBarrier') as
  | SyncBarrier
  | undefined;

export function setupSyncBarrierObserver() {
  if (!gameState) return;

  gameState.observe(() => {
    const barrier = gameState.get('syncBarrier') as SyncBarrier | undefined;

    if (!barrier) {
      if (lastObservedBarrier && lastObservedBarrier.status !== 'released') {
        setSyncPaused(false);
      }
      lastObservedBarrier = undefined;
      refreshMultiplayerSyncState();
      return;
    }

    if (barrier.id !== lastObservedBarrier?.id) {
      if (barrier.status === 'pending') {
        void flushDispatchEventQueue().then(() => {
          setSyncPaused(true);
          refreshMultiplayerSyncState();
        });
      }
    }

    if (barrier.status === 'pending') {
      publishSnapshotForBarrier(barrier);
    }

    if (barrier.status === 'released') {
      setSyncPaused(false);
    }

    lastObservedBarrier = barrier;
    refreshMultiplayerSyncState();
  });
}

/** Request a barrier, wait for host snapshot, hydrate scene, skip event replay. */
export async function acquireWorldSnapshot(
  gameId: string,
  playerSessionId: string,
): Promise<boolean> {
  if (!gameNeedsSnapshotSync(playerSessionId)) return false;

  const barrierId = nanoid();
  await flushDispatchEventQueue();
  setSyncPaused(true);
  refreshMultiplayerSyncState();

  provider?.awareness?.setLocalStateField('syncJoining', true);
  refreshMultiplayerSyncState();

  gameState.doc?.transact(() => {
    gameState.set('syncBarrier', {
      id: barrierId,
      joinerSessionId: playerSessionId,
      status: 'pending',
      requestedAt: Date.now(),
    });
  });

  try {
    const snapshot = await waitForBarrierSnapshot(barrierId, 25_000);
    await applyWorldSnapshot(gameId, playerSessionId, snapshot);
    releaseSyncBarrier(barrierId);
    return true;
  } finally {
    provider?.awareness?.setLocalStateField('syncJoining', false);
    setSyncPaused(false);
    refreshMultiplayerSyncState();
  }
}

export function hasSnapshotCatchUp(): boolean {
  return processedEvents() >= gameLog.length && gameLog.length > 0;
}
