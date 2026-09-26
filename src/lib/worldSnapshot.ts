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
  setDeferGameLogReplay,
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
import { getActiveJoinClientIdsFromLog, setOnGameLogProcessed, waitForGameLogCatchUp, waitForGameLogDocumentSync } from '../remoteEvents';
import { resetCustomCountersForSnapshot } from './ui/counterDialog';
import { refreshMultiplayerSyncState } from './multiplayerSync';
import { slimPlayAreaStateForSnapshot } from './gameLogEvents';
import { devLog } from './devLog';
import {
  logReloadOther,
  syncReloadOtherTraceFromState,
  endReloadOtherTrace,
} from './reloadOtherPlayerDebug';

export const WORLD_SNAPSHOT_VERSION = 1;

const LOCAL_WORLD_SNAPSHOT_PREFIX = 'arcanetable-local-world-snapshot:';

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
    // Primero sanitizar para evitar stack overflow en JSON.stringify
    const sanitized = deepSanitize(value);
    return JSON.parse(JSON.stringify(sanitized)) as T;
  } catch (error) {
    console.error('[worldSnapshot] cloneJson failed even after sanitize', error);
    // Último recurso: devolver el sanitizado sin stringify
    return deepSanitize(value) as T;
  }
}

function deepSanitize(value: unknown, seen = new WeakSet(), depth = 0): unknown {
  const MAX_DEPTH = 32;  // Reducir profundidad máxima para prevenir stack overflow
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  
  // Detectar referencias circulares
  if (seen.has(value as object)) {
    return undefined;  // Sin log para evitar spam en partidas largas
  }
  seen.add(value as object);
  
  // Detectar y omitir objetos Three.js temprano
  const obj = value as Record<string, unknown>;
  if ('isObject3D' in obj || 'isMaterial' in obj || 'isTexture' in obj || 
      'isVector3' in obj || 'isQuaternion' in obj || 'isMatrix4' in obj) {
    return undefined;
  }
  
  if (Array.isArray(value)) {
    // Limitar arrays muy grandes para prevenir problemas de memoria
    const MAX_ARRAY_LENGTH = 10000;
    const items = value.slice(0, MAX_ARRAY_LENGTH);
    return items.map(item => deepSanitize(item, seen, depth + 1)).filter(item => item !== undefined);
  }
  
  const result: Record<string, unknown> = {};
  let keyCount = 0;
  const MAX_KEYS = 1000;  // Limitar objetos muy grandes
  
  for (const [key, val] of Object.entries(obj)) {
    if (keyCount++ > MAX_KEYS) break;
    
    // Omitir funciones y valores problemáticos
    if (typeof val === 'function') continue;
    if (val && typeof val === 'object' && 'isObject3D' in val) continue;
    
    const sanitized = deepSanitize(val, seen, depth + 1);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
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

function readLocalWorldSnapshot(gameId: string): WorldSnapshot | undefined {
  if (!gameId) return undefined;
  try {
    const raw = localStorage.getItem(`${LOCAL_WORLD_SNAPSHOT_PREFIX}${gameId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as WorldSnapshot;
    if (!parsed?.playAreas?.length) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function persistLocalWorldSnapshot(gameId: string) {
  if (!gameId) return;
  if (!Object.values(playAreas).some(area => Boolean(area))) return;

  const snapshot = exportWorldSnapshot('local');
  try {
    localStorage.setItem(`${LOCAL_WORLD_SNAPSHOT_PREFIX}${gameId}`, JSON.stringify(snapshot));
    devLog.debug('[worldSnapshot] Local snapshot saved', {
      gameId,
      logLength: snapshot.logLength,
    });
  } catch (error) {
    devLog.warn('[worldSnapshot] Local snapshot save failed', error);
  }
}

function getLocalPersistedWorldSnapshot(gameId: string): WorldSnapshot | undefined {
  const snapshot = readLocalWorldSnapshot(gameId);
  if (!snapshot) return undefined;
  if (snapshot.logLength > gameLog.length) {
    devLog.debug('[worldSnapshot] Local snapshot ahead of Yjs log', {
      snapshotLogLength: snapshot.logLength,
      currentLogLength: gameLog.length,
    });
    return undefined;
  }
  return snapshot;
}

function getStoredWorldSnapshot(): WorldSnapshot | undefined {
  const snapshot = gameState.get('worldSnapshot') as WorldSnapshot | undefined;
  if (!snapshot?.playAreas?.length) {
    console.log('[worldSnapshot] No snapshot or empty playAreas');
    return undefined;
  }
  if (snapshot.logLength > gameLog.length) {
    console.log('[worldSnapshot] Snapshot ahead of local log (may sync soon)', {
      snapshotLogLength: snapshot.logLength,
      currentLogLength: gameLog.length,
      barrierId: snapshot.barrierId,
    });
    return undefined;
  }
  console.log('[worldSnapshot] Valid snapshot found', {
    logLength: snapshot.logLength,
    currentLogLength: gameLog.length,
    playAreas: snapshot.playAreas.length,
    barrierId: snapshot.barrierId,
  });
  return snapshot;
}

async function waitUntilLogCoversSnapshot(snapshot: WorldSnapshot, maxWaitMs = 12_000): Promise<boolean> {
  if (snapshot.logLength <= gameLog.length) return true;
  return waitForGameLogDocumentSync({
    targetLength: snapshot.logLength,
    maxWaitMs,
  });
}

async function resolveStoredWorldSnapshot(
  gameId: string,
  maxWaitMs = 12_000,
): Promise<WorldSnapshot | undefined> {
  const local = getLocalPersistedWorldSnapshot(gameId);
  if (local) {
    console.log('[worldSnapshot] Using local snapshot', {
      logLength: local.logLength,
      currentLogLength: gameLog.length,
    });
    return local;
  }

  let snapshot = getStoredWorldSnapshot();
  if (snapshot) return snapshot;

  const raw = gameState.get('worldSnapshot') as WorldSnapshot | undefined;
  if (!raw?.playAreas?.length || raw.logLength <= gameLog.length) {
    return undefined;
  }

  console.log('[worldSnapshot] Waiting for game log before applying snapshot', {
    snapshotLogLength: raw.logLength,
    currentLogLength: gameLog.length,
  });
  const ready = await waitUntilLogCoversSnapshot(raw, maxWaitMs);
  if (!ready) {
    console.log('[worldSnapshot] Timed out waiting for log to cover snapshot');
    return undefined;
  }
  snapshot = getStoredWorldSnapshot();
  return snapshot;
}

async function tryApplyStoredWorldSnapshot(gameId: string, playerSessionId: string): Promise<boolean> {
  console.log('[worldSnapshot] Trying to apply stored snapshot');
  const snapshot = await resolveStoredWorldSnapshot(gameId);
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

/** Fallback when live peer sync fails: apply the persistent/barrier snapshot from Yjs. */
export async function applyStoredWorldSnapshotIfAvailable(
  gameId: string,
  playerSessionId: string,
): Promise<boolean> {
  return tryApplyStoredWorldSnapshot(gameId, playerSessionId);
}

function countRemoteNonSpectatingPlayers(): number {
  if (!provider?.awareness) return 0;
  const localId = provider.awareness.clientID;
  return Array.from(provider.awareness.getStates().entries()).filter(
    ([id, entry]) => id !== localId && !entry?.isSpectating,
  ).length;
}

async function requestSnapshotFromPeers(
  gameId: string,
  playerSessionId: string,
  maxWaitMs: number,
): Promise<boolean> {
  if (countRemoteNonSpectatingPlayers() === 0) {
    console.log('[worldSnapshot] No remote players online — skipping peer snapshot request');
    return false;
  }

  console.log('[worldSnapshot] Requesting current state from other players');
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
    const snapshot = await waitForBarrierSnapshot(barrierId, maxWaitMs);
    console.log('[worldSnapshot] Received barrier snapshot, applying...');
    await applyWorldSnapshot(gameId, playerSessionId, snapshot);
    releaseSyncBarrier(barrierId);
    console.log('[worldSnapshot] Barrier snapshot applied successfully');
    return true;
  } catch (error) {
    console.error('[worldSnapshot] Peer snapshot request failed:', error);
    releaseSyncBarrier(barrierId);
    return false;
  } finally {
    provider?.awareness?.setLocalStateField('syncJoining', false);
    setSyncPaused(false);
    refreshMultiplayerSyncState();
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
  setDeferGameLogReplay(false);
  resetGameSceneForReplay();
  resetCustomCountersForSnapshot(gameId);

  const joinClientId =
    findJoinClientIdForSession(gameLog, playerSessionId) ?? getStoredJoinBinding(gameId)?.clientId;

  let localArea: PlayArea | undefined;

  for (const entry of snapshot.playAreas) {
    const isSelf =
      entry.playerSessionId === playerSessionId ||
      (joinClientId !== undefined && entry.clientId === joinClientId);

    const area = PlayArea.fromWorldSnapshot(entry.clientId, entry.state, {
      isLocalPlayer: isSelf,
      gameId: isSelf ? gameId : undefined,
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
  if (gameId) persistLocalWorldSnapshot(gameId);
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
      const snapshot = gameState.get('worldSnapshot') as WorldSnapshot | undefined;
      if (snapshot?.barrierId === barrierId) {
        gameState.delete('worldSnapshot');
        logReloadOther('release-barrier-cleanup-removed-barrier-snapshot', { barrierId });
      }
      gameState.delete('syncBarrier');
      logReloadOther('release-barrier-cleanup-done', { barrierId });
      endReloadOtherTrace('barrier-released');
    });
    if (isSyncHost()) {
      publishPersistentWorldSnapshot();
    }
  }, 300);
}

function detectCircularRefsInSnapshot(
  obj: unknown,
  path = '',
  seen = new WeakSet(),
  depth = 0,
): string | null {
  const MAX_DEPTH = 32;  // Reducir para prevenir stack overflow
  if (depth > MAX_DEPTH) {
    return `Max depth exceeded at: ${path}`;
  }
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return null;
  
  if (seen.has(obj as object)) {
    return `Circular reference at: ${path}`;
  }
  seen.add(obj as object);
  
  const record = obj as Record<string, unknown>;
  
  // Check for Three.js objects
  if ('isObject3D' in record || 'isMaterial' in record || 'isTexture' in record || 
      'isVector3' in record || 'isQuaternion' in record || 'isMatrix4' in record) {
    return `Three.js object at: ${path}`;
  }
  
  if (Array.isArray(obj)) {
    // Solo revisar primeros elementos de arrays muy grandes
    const checkLimit = Math.min(obj.length, 100);
    for (let i = 0; i < checkLimit; i++) {
      const result = detectCircularRefsInSnapshot(obj[i], `${path}[${i}]`, seen, depth + 1);
      if (result) return result;
    }
  } else {
    let keyCount = 0;
    for (const [key, value] of Object.entries(record)) {
      if (keyCount++ > 100) break;  // Limitar chequeo en objetos grandes
      const result = detectCircularRefsInSnapshot(
        value,
        path ? `${path}.${key}` : key,
        seen,
        depth + 1,
      );
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

function publishPersistentWorldSnapshot(onPublished?: (logLength: number) => void) {
  if (!Object.values(playAreas).some(area => Boolean(area))) {
    logReloadOther('publish-persistent-skipped-no-areas');
    return;
  }

  const targetLogLength = gameLog.length;
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
      onPublished?.(targetLogLength);
    });
  });
}

let lastObservedBarrier: SyncBarrier | undefined = gameState?.get?.('syncBarrier') as
  | SyncBarrier
  | undefined;

export function setupSyncBarrierObserver() {
  if (!gameState) return;

  gameState.observe((event) => {
    // Solo reaccionar si el cambio afecta 'syncBarrier'
    const changedKeys = Array.from(event.changes.keys.keys());
    if (!changedKeys.includes('syncBarrier')) {
      return;
    }

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

    if (barrier.status === 'pending' && barrier.id !== lastObservedBarrier?.id) {
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

/** Reconnect: ask peers for live state, else apply stored snapshot — never full log replay. */
export async function acquireWorldSnapshot(
  gameId: string,
  playerSessionId: string,
): Promise<boolean> {
  console.log('[worldSnapshot] acquireWorldSnapshot called', { gameId, playerSessionId });

  if (!gameNeedsSnapshotSync(playerSessionId, gameId)) {
    console.log('[worldSnapshot] Game does not need snapshot sync (new player)');
    return false;
  }

  console.log('[worldSnapshot] Reconnect sync — peers first, stored snapshot fallback');

  await waitForGameLogDocumentSync({ minLength: 1, maxWaitMs: 10_000 });

  const fromPeers = await requestSnapshotFromPeers(gameId, playerSessionId, 12_000);
  if (fromPeers) {
    console.log('[worldSnapshot] Reconnected from peer snapshot');
    return true;
  }

  if (await tryApplyStoredWorldSnapshot(gameId, playerSessionId)) {
    console.log('[worldSnapshot] Reconnected from stored snapshot');
    return true;
  }

  console.log('[worldSnapshot] Reconnect sync failed — no peer or stored snapshot');
  return false;
}

export function setupLocalWorldSnapshotSync(getGameId: () => string | undefined) {
  setOnGameLogProcessed(() => {
    const gameId = getGameId();
    if (gameId) persistLocalWorldSnapshot(gameId);
  });
}

export function setupPersistentSnapshotPublisher(getGameId?: () => string | undefined) {
  if (!gameState) return;

  setupLocalWorldSnapshotSync(getGameId ?? (() => undefined));

  let lastPublishedLogLength = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const publishIfNeeded = () => {
    const currentLogLength = gameLog.length;
    if (currentLogLength === 0 || currentLogLength === lastPublishedLogLength) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      if (!isSyncHost()) {
        logReloadOther('persistent-publisher-skipped-not-host');
        return;
      }

      const length = gameLog.length;
      if (length === 0 || length === lastPublishedLogLength) return;

      logReloadOther('persistent-publisher-scheduled', {
        from: lastPublishedLogLength,
        to: length,
        growth: length - lastPublishedLogLength,
      });
      publishPersistentWorldSnapshot(publishedLength => {
        lastPublishedLogLength = publishedLength;
      });
    }, 500);
  };

  gameLog.observe(publishIfNeeded);
}

export function hasSnapshotCatchUp(): boolean {
  return processedEvents() >= gameLog.length && gameLog.length > 0;
}
