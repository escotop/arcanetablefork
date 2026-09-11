import { DEFAULT_COMMANDER_LIFE } from './constants';
import { gameState, getLocalPlayerClientId, playAreas, players, provider } from './globals';
import type { PlayArea } from './playArea';
import type { TurnOrderState } from './turnOrder';
import type { PlayerAwarenessSnapshot } from './gameStateSnapshot';
import type { WorldSnapshot } from './worldSnapshot';

function normalizeClientId(clientId: unknown): number | undefined {
  const id = Number(clientId);
  return Number.isFinite(id) ? id : undefined;
}

function getPlayAreaPlayerEntry(area: PlayArea) {
  for (const player of players()) {
    if (player.entry?.isSpectating) continue;
    if (player.entry?.syncJoining) continue;
    if (area.playerSessionId && player.entry?.playerSessionId === area.playerSessionId) {
      return player.entry;
    }
    const awarenessClientId = normalizeClientId(player.id);
    if (awarenessClientId !== undefined && awarenessClientId === normalizeClientId(area.clientId)) {
      return player.entry;
    }
  }
  return undefined;
}

function getPlayAreaPlayerName(area: PlayArea) {
  return getPlayAreaPlayerEntry(area)?.name?.trim() || area.lastKnownDisplayName?.trim() || 'Player';
}

export interface OpponentCommanderEntry {
  name: string;
  life: number;
  clientId?: number;
}

export interface CommanderHealthTarget {
  sessionId: string;
  clientId?: number;
  name: string;
  life: number;
  isOnline: boolean;
}

const commanderTrackingBySession = new Map<string, Record<string, OpponentCommanderEntry>>();

function parseTrackingRecord(raw: unknown): Record<string, OpponentCommanderEntry> {
  if (!raw || typeof raw !== 'object') return {};

  const result: Record<string, OpponentCommanderEntry> = {};
  for (const [sessionId, value] of Object.entries(raw as Record<string, unknown>)) {
    const cloned = cloneEntry(value);
    if (cloned) result[sessionId] = cloned;
  }
  return result;
}

function rememberCommanderTracking(sessionId: string | undefined, tracking: Record<string, OpponentCommanderEntry>) {
  if (!sessionId || !Object.keys(tracking).length) return;
  commanderTrackingBySession.set(sessionId, tracking);
}

function readCachedCommanderTracking(sessionId: string | undefined): Record<string, OpponentCommanderEntry> | undefined {
  if (!sessionId) return undefined;
  return commanderTrackingBySession.get(sessionId);
}

function readSnapshotPlayer(playArea: PlayArea): PlayerAwarenessSnapshot | undefined {
  const snapshot = gameState.get('worldSnapshot') as WorldSnapshot | undefined;
  const playersFromSnapshot = snapshot?.players;
  if (!playersFromSnapshot?.length) return undefined;

  return playersFromSnapshot.find(
    player =>
      (playArea.playerSessionId && player.playerSessionId === playArea.playerSessionId) ||
      player.clientId === playArea.clientId,
  );
}

function getLocalPlayerSessionId(): string | undefined {
  return provider?.awareness?.getLocalState()?.playerSessionId as string | undefined;
}

function cloneEntry(value: unknown): OpponentCommanderEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.life !== 'number') return undefined;
  return {
    name: typeof entry.name === 'string' ? entry.name : 'Player',
    life: entry.life,
    ...(typeof entry.clientId === 'number' ? { clientId: entry.clientId } : {}),
  };
}

function readOpponentCommanderTracking(): Record<string, OpponentCommanderEntry> {
  const localState = provider?.awareness?.getLocalState();
  const tracking = localState?.opponentCommanderTracking;
  if (tracking && typeof tracking === 'object') {
    return parseTrackingRecord(tracking);
  }

  const legacy = localState?.opponentCommanderLife;
  if (!legacy || typeof legacy !== 'object') return {};

  const migrated: Record<string, OpponentCommanderEntry> = {};
  for (const [clientIdKey, life] of Object.entries(legacy as Record<string, unknown>)) {
    if (typeof life !== 'number') continue;
    const clientId = Number(clientIdKey);
    if (!Number.isFinite(clientId)) continue;
    const area = playAreas[clientId];
    const sessionId = area?.playerSessionId ?? getPlayAreaPlayerEntry(area as PlayArea)?.playerSessionId;
    if (!sessionId) continue;
    migrated[sessionId] = {
      name: area ? getPlayAreaPlayerName(area) : 'Player',
      life,
      clientId,
    };
  }

  if (Object.keys(migrated).length) {
    writeOpponentCommanderTracking(migrated);
    provider?.awareness?.setLocalStateField('opponentCommanderLife', null);
  }

  return migrated;
}

function readPlayerCommanderTracking(playArea: PlayArea): Record<string, OpponentCommanderEntry> {
  const awarenessEntry = getPlayAreaPlayerEntry(playArea);
  if (awarenessEntry?.opponentCommanderTracking) {
    const tracking = parseTrackingRecord(awarenessEntry.opponentCommanderTracking);
    rememberCommanderTracking(playArea.playerSessionId, tracking);
    return tracking;
  }

  const cached = readCachedCommanderTracking(playArea.playerSessionId);
  if (cached) return cached;

  const snapshotPlayer = readSnapshotPlayer(playArea);
  if (snapshotPlayer?.opponentCommanderTracking) {
    const tracking = parseTrackingRecord(snapshotPlayer.opponentCommanderTracking);
    rememberCommanderTracking(playArea.playerSessionId, tracking);
    return tracking;
  }

  return {};
}

function sortCommanderHealthTargets(
  targets: CommanderHealthTarget[],
  turnState: TurnOrderState | null,
) {
  const orderMap = turnState?.order.length
    ? new Map(turnState.order.map((clientId, index) => [clientId, index]))
    : null;

  return targets.sort((left, right) => {
    if (left.isOnline !== right.isOnline) return left.isOnline ? -1 : 1;
    if (left.isOnline && right.isOnline && orderMap && left.clientId && right.clientId) {
      return (
        (orderMap.get(left.clientId) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(right.clientId) ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return left.name.localeCompare(right.name);
  });
}

function toPlainTracking(tracking: Record<string, OpponentCommanderEntry>) {
  const plain: Record<string, { name: string; life: number; clientId?: number }> = {};
  for (const [sessionId, entry] of Object.entries(tracking)) {
    plain[sessionId] = {
      name: entry.name,
      life: entry.life,
      ...(entry.clientId !== undefined ? { clientId: entry.clientId } : {}),
    };
  }
  return plain;
}

function writeOpponentCommanderTracking(tracking: Record<string, OpponentCommanderEntry>) {
  if (!provider?.awareness) return;
  const localSessionId = getLocalPlayerSessionId();
  if (localSessionId) rememberCommanderTracking(localSessionId, tracking);
  provider.awareness.setLocalStateField('opponentCommanderTracking', toPlainTracking(tracking));
}

export function syncOpponentCommanderTrackingFromTable(): boolean {
  const tracking = readOpponentCommanderTracking();
  const localSessionId = getLocalPlayerSessionId();
  let changed = false;

  for (const area of Object.values(playAreas)) {
    if (!area || area.isLocalPlayArea || area.clientId === getLocalPlayerClientId()) continue;

    const sessionId = area.playerSessionId ?? getPlayAreaPlayerEntry(area)?.playerSessionId;
    if (!sessionId || sessionId === localSessionId) continue;

    const name = getPlayAreaPlayerName(area);
    const existing = tracking[sessionId];
    if (
      !existing ||
      existing.name !== name ||
      existing.clientId !== area.clientId ||
      existing.life === undefined
    ) {
      tracking[sessionId] = {
        name,
        life: existing?.life ?? DEFAULT_COMMANDER_LIFE,
        clientId: area.clientId,
      };
      changed = true;
    }
  }

  if (changed) writeOpponentCommanderTracking(tracking);
  return changed;
}

function resolveOwnerSessionId(playArea?: PlayArea): string | undefined {
  if (!playArea) return undefined;
  return playArea.playerSessionId ?? getPlayAreaPlayerEntry(playArea)?.playerSessionId;
}

function isOwnerCommanderTarget(
  sessionId: string,
  entry: OpponentCommanderEntry,
  ownerSessionId: string | undefined,
  ownerClientId: number | undefined,
): boolean {
  if (ownerSessionId && sessionId === ownerSessionId) return true;
  if (ownerClientId !== undefined && entry.clientId === ownerClientId) return true;

  const ownerArea = ownerClientId !== undefined ? playAreas[ownerClientId] : undefined;
  if (ownerArea?.playerSessionId && sessionId === ownerArea.playerSessionId) return true;

  const targetArea =
    entry.clientId !== undefined
      ? playAreas[entry.clientId]
      : Object.values(playAreas).find(area => area?.playerSessionId === sessionId);
  if (
    ownerClientId !== undefined &&
    targetArea &&
    (targetArea.clientId === ownerClientId ||
      (ownerSessionId && targetArea.playerSessionId === ownerSessionId))
  ) {
    return true;
  }

  return false;
}

function buildCommanderHealthTargets(
  tracking: Record<string, OpponentCommanderEntry>,
  ownerSessionId: string | undefined,
  ownerClientId: number | undefined,
  turnState: TurnOrderState | null,
): CommanderHealthTarget[] {
  const targets = Object.entries(tracking)
    .filter(
      ([sessionId, entry]) =>
        !isOwnerCommanderTarget(sessionId, entry, ownerSessionId, ownerClientId),
    )
    .map(([sessionId, entry]) => ({
      sessionId,
      clientId: entry.clientId,
      name: entry.name,
      life: entry.life,
      isOnline: entry.clientId !== undefined && !!playAreas[entry.clientId],
    }));

  return sortCommanderHealthTargets(targets, turnState);
}

/** Local player's editable commander notes. */
export function getCommanderHealthTargets(turnState: TurnOrderState | null): CommanderHealthTarget[] {
  syncOpponentCommanderTrackingFromTable();
  return buildCommanderHealthTargets(
    readOpponentCommanderTracking(),
    getLocalPlayerSessionId(),
    getLocalPlayerClientId(),
    turnState,
  );
}

/** Another player's commander notes as published in their awareness (read-only). */
export function getRemotePlayerCommanderHealthTargets(
  playArea: PlayArea | undefined,
  turnState: TurnOrderState | null,
): CommanderHealthTarget[] {
  if (!playArea) return [];

  return buildCommanderHealthTargets(
    readPlayerCommanderTracking(playArea),
    resolveOwnerSessionId(playArea),
    playArea.clientId,
    turnState,
  );
}

export function getTrackedOpponentCommanderLife(clientId: number): number {
  syncOpponentCommanderTrackingFromTable();
  const area = playAreas[clientId];
  const sessionId = area?.playerSessionId ?? getPlayAreaPlayerEntry(area)?.playerSessionId;
  if (sessionId) {
    const entry = readOpponentCommanderTracking()[sessionId];
    if (entry) return entry.life;
  }
  return DEFAULT_COMMANDER_LIFE;
}

export function setTrackedOpponentCommanderLife(sessionId: string, life: number) {
  const tracking = readOpponentCommanderTracking();
  const existing = tracking[sessionId];
  if (!existing || existing.life === life) return;

  writeOpponentCommanderTracking({
    ...tracking,
    [sessionId]: { ...existing, life },
  });
}

export function removeOpponentCommanderTracking(playerSessionId: string | undefined) {
  if (!playerSessionId || !provider?.awareness) return;
  const tracking = readOpponentCommanderTracking();
  if (!(playerSessionId in tracking)) return;

  const next = { ...tracking };
  delete next[playerSessionId];
  writeOpponentCommanderTracking(next);
}
