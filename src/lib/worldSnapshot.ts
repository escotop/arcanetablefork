import { nanoid } from 'nanoid';
import {
  gameLog,
  gameState,
  playAreas,
  provider,
  resetGameSceneForReplay,
  sendEvent,
  setEventCatchUpComplete,
  finishHistoricalLogReplay,
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
import { getActiveJoinClientIdsFromLog, waitForGameLogCatchUp } from '../remoteEvents';
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

export function gameNeedsSnapshotSync(playerSessionId: string, gameId: string): boolean {
  if (!gameLog?.length) return false;

  const joinClientId =
    findJoinClientIdForSession(gameLog, playerSessionId) ??
    getStoredJoinBinding(gameId)?.clientId;

  // Solo reconexiones usan snapshot; un jugador nuevo entra sin barrera
  return joinClientId !== undefined;
}

function getLocalPlayerSessionId(): string | undefined {
  return provider?.awareness?.getLocalState()?.playerSessionId as string | undefined;
}

function isLocalJoiner(barrier: SyncBarrier): boolean {
  const localSessionId = getLocalPlayerSessionId();
  return !!localSessionId && localSessionId === barrier.joinerSessionId;
}

function shouldPublishSnapshotForBarrier(barrier: SyncBarrier): boolean {
  if (barrier.status !== 'pending') return false;
  if (isLocalJoiner(barrier)) return false;
  return Object.values(playAreas).some(area => Boolean(area));
}

function getStoredWorldSnapshot(): WorldSnapshot | undefined {
  const snapshot = gameState.get('worldSnapshot') as WorldSnapshot | undefined;
  if (!snapshot?.playAreas?.length) return undefined;
  if (snapshot.logLength > gameLog.length) return undefined;
  return snapshot;
}

async function tryApplyStoredWorldSnapshot(gameId: string, playerSessionId: string): Promise<boolean> {
  const snapshot = getStoredWorldSnapshot();
  if (!snapshot) return false;

  try {
    await applyWorldSnapshot(gameId, playerSessionId, snapshot);
    return true;
  } catch {
    return false;
  }
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

  readjustPlayAreas();

  // Replay only events that arrived after the snapshot was taken.
  setProcessedEvents(snapshot.logLength);
  if (processedEvents() < gameLog.length) {
    await waitForGameLogCatchUp({ maxWaitMs: 15_000 });
  }

  readjustPlayAreas();
  Object.values(playAreas).forEach(area => area?.reapplyBattlefieldOrientations());
  requestAnimationFrame(() => {
    Object.values(playAreas).forEach(area => area?.reapplyBattlefieldOrientations());
  });

  if (localArea) {
    localArea.setAsLocalPlayArea();
    localArea.subscribeEvents(sendEvent);
    setLocalPlayerClientId(localArea.clientId);
    persistJoinBinding(gameId, { playerSessionId, clientId: localArea.clientId });
    setIsIntitialized(true);
    void localArea.loadTextures();
  }

  setEventCatchUpComplete(true);
  finishHistoricalLogReplay();
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
  if (!shouldPublishSnapshotForBarrier(barrier)) return;

  void flushDispatchEventQueue().then(async () => {
    await waitForGameLogCatchUp({ maxWaitMs: 5_000 });
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

function publishPersistentWorldSnapshot() {
  if (!Object.values(playAreas).some(area => Boolean(area))) return;

  void flushDispatchEventQueue().then(async () => {
    await waitForGameLogCatchUp({ maxWaitMs: 3_000 });
    const snapshot = exportWorldSnapshot('persistent');
    gameState.doc?.transact(() => {
      const activeBarrier = gameState.get('syncBarrier') as SyncBarrier | undefined;
      if (activeBarrier && activeBarrier.status === 'pending') return;
      gameState.set('worldSnapshot', snapshot);
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
      if (
        lastObservedBarrier &&
        lastObservedBarrier.status !== 'released' &&
        isLocalJoiner(lastObservedBarrier)
      ) {
        setSyncPaused(false);
      }
      lastObservedBarrier = undefined;
      refreshMultiplayerSyncState();
      return;
    }

    if (barrier.id !== lastObservedBarrier?.id && barrier.status === 'pending' && isLocalJoiner(barrier)) {
      void flushDispatchEventQueue().then(() => {
        setSyncPaused(true);
        refreshMultiplayerSyncState();
      });
    }

    if (barrier.status === 'pending') {
      publishSnapshotForBarrier(barrier);
    }

    if (barrier.status === 'released') {
      if (isLocalJoiner(barrier)) {
        setSyncPaused(false);
      }
    }

    lastObservedBarrier = barrier;
    refreshMultiplayerSyncState();
  });
}

/** Request a barrier, wait for snapshot, hydrate scene, skip event replay. */
export async function acquireWorldSnapshot(
  gameId: string,
  playerSessionId: string,
): Promise<boolean> {
  if (!gameNeedsSnapshotSync(playerSessionId, gameId)) return false;

  if (await tryApplyStoredWorldSnapshot(gameId, playerSessionId)) {
    return true;
  }

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
    const snapshot = await waitForBarrierSnapshot(barrierId, 12_000);
    await applyWorldSnapshot(gameId, playerSessionId, snapshot);
    releaseSyncBarrier(barrierId);
    return true;
  } catch {
    if (await tryApplyStoredWorldSnapshot(gameId, playerSessionId)) {
      releaseSyncBarrier(barrierId);
      return true;
    }
    releaseSyncBarrier(barrierId);
    return false;
  } finally {
    provider?.awareness?.setLocalStateField('syncJoining', false);
    setSyncPaused(false);
    refreshMultiplayerSyncState();
  }
}

export function setupPersistentSnapshotPublisher() {
  if (!gameState) return;

  let publishTimer: number | undefined;
  const schedulePublish = () => {
    if (publishTimer !== undefined) return;
    publishTimer = window.setTimeout(() => {
      publishTimer = undefined;
      if (isSyncHost()) {
        publishPersistentWorldSnapshot();
      }
    }, 1500);
  };

  gameLog.observe(schedulePublish);
  gameState.observe(event => {
    if (event.changes.keys.has('syncBarrier')) return;
    schedulePublish();
  });
}

export function hasSnapshotCatchUp(): boolean {
  return processedEvents() >= gameLog.length && gameLog.length > 0;
}
