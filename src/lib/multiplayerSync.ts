import { createSignal } from 'solid-js';
import { gameState, playAreas, players, provider, setGameplayBlocked } from './globals';
import type { SyncBarrier } from './worldSnapshot';
import { getPlayAreaPlayerName } from './playAreaNameTag';
import { logReloadOther } from './reloadOtherPlayerDebug';

export interface MultiplayerBlockState {
  blocked: boolean;
  message: string;
  isJoiner: boolean;
}

export const [multiplayerBlockState, setMultiplayerBlockState] = createSignal<MultiplayerBlockState>({
  blocked: false,
  message: '',
  isJoiner: false,
});

export function resetMultiplayerSyncState() {
  setMultiplayerBlockState({ blocked: false, message: '', isJoiner: false });
  setGameplayBlocked(false);
}

export function isGameplayBlocked() {
  return multiplayerBlockState().blocked;
}

function getActiveSyncBarrier(): SyncBarrier | undefined {
  const barrier = gameState?.get?.('syncBarrier') as SyncBarrier | undefined;
  if (!barrier || barrier.status === 'released') return undefined;
  return barrier;
}

function getJoiningPlayerLabel(joinerSessionId?: string) {
  if (!joinerSessionId) return 'Player';

  for (const player of players()) {
    if (player.entry?.playerSessionId === joinerSessionId) {
      return player.entry?.name || 'Player';
    }
  }

  for (const area of Object.values(playAreas)) {
    if (area?.playerSessionId === joinerSessionId) {
      return getPlayAreaPlayerName(area);
    }
  }

  return 'Player';
}

export function refreshMultiplayerSyncState() {
  logReloadOther('refresh-multiplayer-sync-start');
  const localState = provider?.awareness?.getLocalState() ?? {};
  const localSessionId = localState.playerSessionId as string | undefined;
  const localClientId = provider?.awareness?.clientID;
  const barrier = getActiveSyncBarrier();

  const isJoiner =
    !!localState.syncJoining ||
    (barrier?.joinerSessionId !== undefined && barrier.joinerSessionId === localSessionId);

  const barrierActive = barrier?.status === 'pending' || barrier?.status === 'ready';
  const someoneElseJoining = players().some(
    player => player.entry?.syncJoining && player.id !== localClientId,
  );

  const blocked = isJoiner && (barrierActive || !!localState.syncJoining);

  let message = '';
  if (barrierActive || someoneElseJoining) {
    if (isJoiner) {
      message = 'Joining game…';
    } else {
      const joinerName = getJoiningPlayerLabel(
        barrier?.joinerSessionId ??
          players().find(player => player.entry?.syncJoining)?.entry?.playerSessionId,
      );
      message = `${joinerName} is joining…`;
    }
  }

  setMultiplayerBlockState({ blocked, message, isJoiner });
  setGameplayBlocked(blocked);
  logReloadOther('refresh-multiplayer-sync-done', {
    blocked,
    isJoiner,
    barrierStatus: barrier?.status,
    someoneElseJoining,
  });
}
