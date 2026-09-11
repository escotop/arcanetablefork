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
import { slimPlayAreaStateForSnapshot } from './gameLogEvents';
import { devLog } from './devLog';
import {
  logReloadOther,
  syncReloadOtherTraceFromState,
  endReloadOtherTrace,
} from './reloadOtherPlayerDebug';

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
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('[worldSnapshot] cloneJson failed, attempting deep sanitize', error);
    return deepSanitize(value) as T;
  }
}

function deepSanitize(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  
  // Detectar referencias circulares
  if (seen.has(value as object)) {
    console.warn('[worldSnapshot] Circular reference detected and removed');
    return undefined;
  }
  seen.add(value as object);
  
  if (Array.isArray(value)) {
    return value.map(item => deepSanitize(item, seen));
  }
  
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    // Omitir campos que son meshes de Three.js
    if (val && typeof val === 'object' && 'isObject3D' in val) {
      continue;
    }
    // Omitir funciones
    if (typeof val === 'function') {
      continue;
    }
    result[key] = deepSanitize(val, seen);
  }
  return result;
}

function capturePlayerAwareness(): PlayerAwarenessSnapshot[] {
  if (!provider?.awareness) return [];

  return Array.from(provider.awareness.getStates().entries()).map(([clientId, entry]) => ({
    clientId,
    playerSessionId: entry.playerSessionId,
    name: entry.name,
    life: entry.life,
    commanderLife: entry.commanderLife,
    opponentCommanderTracking: entry.opponentCommanderTracking
      ? JSON.parse(JSON.stringify(entry.opponentCommanderTracking))
      : undefined,
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

export function gameNeedsSnapshotSync(playerSessionId: string, _gameId: string): boolean {
  if (!gameLog?.length) return false;
  return findJoinClientIdForSession(gameLog, playerSessionId) !== undefined;
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
  if (!snapshot?.playAreas?.length) {
    console.log('[worldSnapshot] No snapshot or empty playAreas');
    return undefined;
  }
  if (snapshot.logLength > gameLog.length) {
    console.log('[worldSnapshot] Snapshot too new', {
      snapshotLogLength: snapshot.logLength,
      currentLogLength: gameLog.length,
    });
    return undefined;
  }
  console.log('[worldSnapshot] Valid snapshot found', {
    logLength: snapshot.logLength,
    currentLogLength: gameLog.length,
    playAreas: snapshot.playAreas.length,
  });
  return snapshot;
}

async function tryApplyStoredWorldSnapshot(gameId: string, playerSessionId: string): Promise<boolean> {
  console.log('[worldSnapshot] Trying to apply stored snapshot');
  const snapshot = getStoredWorldSnapshot();
  if (!snapshot) {
    console.log('[worldSnapshot] No stored snapshot available');
    return false;
  }

  try {
    console.log('[worldSnapshot] Applying snapshot...');
    await applyWorldSnapshot(gameId, playerSessionId, snapshot);
    console.log('[worldSnapshot] Snapshot applied successfully');
    return true;
  } catch (error) {
    console.error('[worldSnapshot] Failed to apply snapshot:', error);
    return false;
  }
}

export function exportWorldSnapshot(barrierId: string): WorldSnapshot {
  const playAreaEntries: WorldSnapshotPlayArea[] = Object.values(playAreas)
    .filter(Boolean)
    .map(area => ({
      clientId: area.clientId,
      playerSessionId: area.playerSessionId,
      state: cloneJson(slimPlayAreaStateForSnapshot(area.getLocalState() as Record<string, unknown>)),
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
    opponentCommanderTracking: snapshot.opponentCommanderTracking ?? localState.opponentCommanderTracking,
    color: snapshot.color ?? localState.color,
    counters: snapshot.counters ?? localState.counters,
    isSpectating: snapshot.isSpectating ?? localState.isSpectating,
  });

  if (snapshot.color) {
    syncLocalPlayerColor(snapshot.color);
  }
}

export function restoreLocalPlayerAwarenessFromWorldSnapshot(gameId: string): boolean {
  const snapshot = gameState.get('worldSnapshot') as WorldSnapshot | undefined;
  if (!snapshot?.players?.length) return false;
  restorePlayerAwareness(snapshot.players, gameId);
  return true;
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
  logReloadOther('release-barrier-start', { barrierId });
  gameState.doc?.transact(() => {
    const current = gameState.get('syncBarrier') as SyncBarrier | undefined;
    if (current?.id !== barrierId) return;
    gameState.set('syncBarrier', { ...current, status: 'released' });
    logReloadOther('release-barrier-set-released', { barrierId });
  });

  window.setTimeout(() => {
    gameState.doc?.transact(() => {
      logReloadOther('release-barrier-cleanup-start', { barrierId });
      const current = gameState.get('syncBarrier') as SyncBarrier | undefined;
      if (current?.id !== barrierId) return;
      gameState.delete('syncBarrier');
      gameState.delete('worldSnapshot');
      logReloadOther('release-barrier-cleanup-done', { barrierId });
      endReloadOtherTrace('barrier-released');
    });
  }, 300);
}

function detectCircularRefsInSnapshot(obj: unknown, path = '', seen = new WeakSet()): string | null {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return null;
  
  if (seen.has(obj as object)) {
    return `Circular reference at: ${path}`;
  }
  seen.add(obj as object);
  
  // Check for Three.js objects
  if ('isObject3D' in obj || 'isMaterial' in obj || 'isTexture' in obj || 'isVector3' in obj) {
    return `Three.js object at: ${path} (keys: ${Object.keys(obj).slice(0, 5).join(', ')})`;
  }
  
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = detectCircularRefsInSnapshot(obj[i], `${path}[${i}]`, seen);
      if (result) return result;
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const result = detectCircularRefsInSnapshot(value, path ? `${path}.${key}` : key, seen);
      if (result) return result;
    }
  }
  return null;
}

function safeSetWorldSnapshot(snapshot: WorldSnapshot) {
  logReloadOther('safe-set-world-snapshot-start', {
    barrierId: snapshot.barrierId,
    logLength: snapshot.logLength,
    playAreas: snapshot.playAreas.length,
  });
  const circular = detectCircularRefsInSnapshot(snapshot);
  if (circular) {
    logReloadOther('safe-set-world-snapshot-circular-ref', { circular });
    console.error('[SNAPSHOT_CIRCULAR_REF]', circular);
    // Try to identify which playArea has the issue
    for (let i = 0; i < snapshot.playAreas.length; i++) {
      const areaCircular = detectCircularRefsInSnapshot(snapshot.playAreas[i], `playAreas[${i}]`);
      if (areaCircular) {
        console.error('[SNAPSHOT_AREA_ISSUE]', areaCircular);
        console.error('[AREA_STATE_KEYS]', Object.keys(snapshot.playAreas[i].state));
      }
    }
    return false;
  }
  try {
    gameState.set('worldSnapshot', snapshot);
    logReloadOther('safe-set-world-snapshot-done', { barrierId: snapshot.barrierId });
    return true;
  } catch (error) {
    logReloadOther('safe-set-world-snapshot-threw', {
      barrierId: snapshot.barrierId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function publishSnapshotForBarrier(barrier: SyncBarrier) {
  if (!shouldPublishSnapshotForBarrier(barrier)) {
    logReloadOther('publish-barrier-skipped', { barrierId: barrier.id });
    return;
  }

  logReloadOther('publish-barrier-scheduled', { barrierId: barrier.id });
  void flushDispatchEventQueue().then(async () => {
    logReloadOther('publish-barrier-flush-done', { barrierId: barrier.id });
    await waitForGameLogCatchUp({ maxWaitMs: 5_000 });
    logReloadOther('publish-barrier-catchup-done', { barrierId: barrier.id });
    const snapshot = exportWorldSnapshot(barrier.id);
    logReloadOther('publish-barrier-export-done', {
      barrierId: barrier.id,
      logLength: snapshot.logLength,
    });
    gameState.doc?.transact(() => {
      logReloadOther('publish-barrier-transact-start', { barrierId: barrier.id });
      const current = gameState.get('syncBarrier') as SyncBarrier | undefined;
      if (current?.id !== barrier.id || current.status !== 'pending') {
        logReloadOther('publish-barrier-transact-abort', {
          barrierId: barrier.id,
          currentStatus: current?.status,
        });
        return;
      }
      if (!safeSetWorldSnapshot(snapshot)) {
        console.error('[worldSnapshot] Failed to set snapshot due to circular refs');
        return;
      }
      console.log('[worldSnapshot] Published barrier snapshot', { 
        barrierId: barrier.id,
        logLength: snapshot.logLength
      });
      gameState.set('syncBarrier', {
        ...current,
        status: 'ready',
        snapshotVersion: snapshot.snapshotVersion,
        hostClientId: provider?.awareness?.clientID,
      });
      logReloadOther('publish-barrier-transact-done', { barrierId: barrier.id });
    });
  });
}

function publishPersistentWorldSnapshot() {
  if (!Object.values(playAreas).some(area => Boolean(area))) {
    logReloadOther('publish-persistent-skipped-no-areas');
    return;
  }

  logReloadOther('publish-persistent-scheduled');
  void flushDispatchEventQueue().then(async () => {
    logReloadOther('publish-persistent-flush-done');
    await waitForGameLogCatchUp({ maxWaitMs: 3_000 });
    logReloadOther('publish-persistent-catchup-done');
    const snapshot = exportWorldSnapshot('persistent');
    logReloadOther('publish-persistent-export-done', { logLength: snapshot.logLength });
    gameState.doc?.transact(() => {
      logReloadOther('publish-persistent-transact-start');
      const activeBarrier = gameState.get('syncBarrier') as SyncBarrier | undefined;
      if (activeBarrier && activeBarrier.status === 'pending') {
        logReloadOther('publish-persistent-transact-abort-barrier-pending');
        return;
      }
      if (!safeSetWorldSnapshot(snapshot)) {
        console.error('[worldSnapshot] Failed to set persistent snapshot due to circular refs');
        return;
      }
      devLog.debug('[worldSnapshot] Published persistent snapshot', {
        logLength: snapshot.logLength,
        playAreas: snapshot.playAreas.length,
      });
      logReloadOther('publish-persistent-transact-done');
    });
  });
}

let lastObservedBarrier: SyncBarrier | undefined = gameState?.get?.('syncBarrier') as
  | SyncBarrier
  | undefined;

export function setupSyncBarrierObserver() {
  if (!gameState) return;

  gameState.observe(() => {
    syncReloadOtherTraceFromState('sync-barrier-observer');
    const barrier = gameState.get('syncBarrier') as SyncBarrier | undefined;
    logReloadOther('sync-barrier-observer-fired', {
      hasBarrier: !!barrier,
      status: barrier?.status,
      barrierId: barrier?.id,
    });

    if (!barrier) {
      if (
        lastObservedBarrier &&
        lastObservedBarrier.status !== 'released' &&
        isLocalJoiner(lastObservedBarrier)
      ) {
        logReloadOther('sync-barrier-cleared-unpause-joiner');
        setSyncPaused(false);
      }
      lastObservedBarrier = undefined;
      refreshMultiplayerSyncState();
      return;
    }

    if (barrier.id !== lastObservedBarrier?.id && barrier.status === 'pending' && isLocalJoiner(barrier)) {
      logReloadOther('sync-barrier-joiner-pause');
      void flushDispatchEventQueue().then(() => {
        setSyncPaused(true);
        refreshMultiplayerSyncState();
      });
    }

    if (barrier.status === 'pending') {
      logReloadOther('sync-barrier-pending-publish-request', { barrierId: barrier.id });
      publishSnapshotForBarrier(barrier);
    }

    if (barrier.status === 'released') {
      logReloadOther('sync-barrier-released', { barrierId: barrier.id });
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
  console.log('[worldSnapshot] acquireWorldSnapshot called', { gameId, playerSessionId });
  
  if (!gameNeedsSnapshotSync(playerSessionId, gameId)) {
    console.log('[worldSnapshot] Game does not need snapshot sync (new player)');
    return false;
  }

  console.log('[worldSnapshot] Game needs snapshot sync (reconnecting player)');
  
  if (await tryApplyStoredWorldSnapshot(gameId, playerSessionId)) {
    console.log('[worldSnapshot] Used stored snapshot successfully');
    return true;
  }

  console.log('[worldSnapshot] Creating sync barrier for fresh snapshot');
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
    console.log('[worldSnapshot] Waiting for barrier snapshot...');
    const snapshot = await waitForBarrierSnapshot(barrierId, 12_000);
    console.log('[worldSnapshot] Received barrier snapshot, applying...');
    await applyWorldSnapshot(gameId, playerSessionId, snapshot);
    releaseSyncBarrier(barrierId);
    console.log('[worldSnapshot] Barrier snapshot applied successfully');
    return true;
  } catch (error) {
    console.error('[worldSnapshot] Barrier snapshot failed:', error);
    if (await tryApplyStoredWorldSnapshot(gameId, playerSessionId)) {
      console.log('[worldSnapshot] Fallback to stored snapshot succeeded');
      releaseSyncBarrier(barrierId);
      return true;
    }
    console.error('[worldSnapshot] All snapshot methods failed, will use full replay');
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

  let lastPublishedLogLength = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const publishIfNeeded = () => {
    logReloadOther('persistent-publisher-gamelog-observe', { gameLogLength: gameLog.length });
    const currentLogLength = gameLog.length;
    if (currentLogLength === lastPublishedLogLength) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      if (!isSyncHost()) {
        logReloadOther('persistent-publisher-skipped-not-host');
        return;
      }

      const length = gameLog.length;
      if (length === lastPublishedLogLength) return;

      logReloadOther('persistent-publisher-scheduled', {
        from: lastPublishedLogLength,
        to: length,
      });
      lastPublishedLogLength = length;
      publishPersistentWorldSnapshot();
    }, 150);
  };

  gameLog.observe(publishIfNeeded);
}

export function hasSnapshotCatchUp(): boolean {
  return processedEvents() >= gameLog.length && gameLog.length > 0;
}
