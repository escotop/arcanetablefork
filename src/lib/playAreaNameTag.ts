import { players } from './globals';
import type { PlayArea } from './playArea';

function normalizeClientId(clientId: unknown): number | undefined {
  const id = Number(clientId);
  return Number.isFinite(id) ? id : undefined;
}

export function getPlayAreaPlayerEntry(playArea: PlayArea) {
  for (const player of players()) {
    if (player.entry?.isSpectating) continue;
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
  return getPlayAreaPlayerEntry(playArea)?.name || 'Player';
}
