import { getTrackedOpponentCommanderLife } from './commanderTracking';
import { getLocalPlayerClientId, players, playAreas } from './globals';
import { displayPlayerColor, getPlayAreaPlayerColor } from './playerColor';
import type { TurnOrderState } from './turnOrder';
import { getActiveTurnClientId } from './turnOrder';
import type { PlayArea } from './playArea';

function normalizeClientId(clientId: unknown): number | undefined {
  const id = Number(clientId);
  return Number.isFinite(id) ? id : undefined;
}

export function getPlayAreaPlayerEntry(playArea: PlayArea) {
  for (const player of players()) {
    if (player.entry?.isSpectating) continue;
    if (player.entry?.syncJoining) continue;
    if (playArea.playerSessionId && player.entry?.playerSessionId === playArea.playerSessionId) {
      return player.entry;
    }
    const awarenessClientId = normalizeClientId(player.id);
    if (
      awarenessClientId !== undefined &&
      awarenessClientId === normalizeClientId(playArea.clientId)
    ) {
      return player.entry;
    }
  }
  return undefined;
}

export function getPlayAreaPlayerName(playArea: PlayArea) {
  return getPlayAreaPlayerEntry(playArea)?.name?.trim() || 'Player';
}

function getLogPlayerEntry(clientId: unknown) {
  const normalizedId = Number(clientId);
  if (!Number.isFinite(normalizedId)) return undefined;

  const byAwarenessId = players().find(player => Number(player.id) === normalizedId);
  if (byAwarenessId?.entry) return byAwarenessId.entry;

  const playArea = playAreas[normalizedId];
  if (!playArea) return undefined;

  return getPlayAreaPlayerEntry(playArea);
}

/** Resolve a game-log clientID to a display name after reload/reconnect. */
export function resolveLogPlayerName(clientId: unknown) {
  return getLogPlayerEntry(clientId)?.name?.trim() || undefined;
}

export function resolveLogPlayerColor(clientId: unknown) {
  const entry = getLogPlayerEntry(clientId);
  if (entry) return displayPlayerColor(entry);

  const normalizedId = Number(clientId);
  const playArea = Number.isFinite(normalizedId) ? playAreas[normalizedId] : undefined;
  if (playArea) return getPlayAreaPlayerColor(playArea);

  return displayPlayerColor({ name: resolveLogPlayerName(clientId) ?? 'Player' });
}

export interface LifeBarPlayer {
  clientId: number;
  playerSessionId?: string;
  name: string;
  life?: number;
  commanderLife?: number;
  counters?: Record<string, number>;
  isLocal: boolean;
  isActiveTurn: boolean;
}

/** @deprecated use getLifeBarPlayersInTurnOrder */
export type NetworkLifeBarPlayer = Omit<LifeBarPlayer, 'isLocal' | 'isActiveTurn'>;

function buildLifeBarPlayer(area: PlayArea, turnState: TurnOrderState | null): LifeBarPlayer {
  const localClientId = getLocalPlayerClientId();
  const entry = getPlayAreaPlayerEntry(area);
  const activeClientId = getActiveTurnClientId(turnState);

  const isLocal = !!area.isLocalPlayArea || area.clientId === localClientId;

  return {
    clientId: area.clientId,
    playerSessionId: area.playerSessionId ?? entry?.playerSessionId,
    name: entry?.name?.trim() || getPlayAreaPlayerName(area),
    life: entry?.life,
    commanderLife: isLocal ? undefined : getTrackedOpponentCommanderLife(area.clientId),
    counters: entry?.counters,
    isLocal,
    isActiveTurn: area.clientId === activeClientId,
  };
}

export function getLifeBarPlayersInTurnOrder(turnState: TurnOrderState | null): LifeBarPlayer[] {
  const playersOnTable = Object.values(playAreas)
    .filter((area): area is PlayArea => !!area)
    .map(area => buildLifeBarPlayer(area, turnState));

  const localPlayers = playersOnTable.filter(player => player.isLocal);
  const remotePlayers = playersOnTable.filter(player => !player.isLocal);

  const sortRemotePlayers = (players: LifeBarPlayer[]) => {
    if (turnState?.order.length) {
      const orderMap = new Map(turnState.order.map((clientId, index) => [clientId, index]));
      return [...players].sort(
        (left, right) =>
          (orderMap.get(left.clientId) ?? Number.MAX_SAFE_INTEGER) -
          (orderMap.get(right.clientId) ?? Number.MAX_SAFE_INTEGER),
      );
    }

    return [...players].sort((left, right) => left.name.localeCompare(right.name));
  };

  return [...localPlayers, ...sortRemotePlayers(remotePlayers)];
}

/** Life bars for remote seats — one entry per play area, not raw awareness clients. */
export function getNetworkLifeBarPlayers(): NetworkLifeBarPlayer[] {
  return getLifeBarPlayersInTurnOrder(null)
    .filter(player => !player.isLocal)
    .map(({ isLocal: _isLocal, isActiveTurn: _isActiveTurn, ...player }) => player);
}
