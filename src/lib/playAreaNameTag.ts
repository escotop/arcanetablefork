import { players } from './globals';
import type { PlayArea } from './playArea';

export function getPlayAreaPlayerEntry(playArea: PlayArea) {
  for (const player of players()) {
    if (playArea.playerSessionId && player.entry.playerSessionId === playArea.playerSessionId) {
      return player.entry;
    }
    if (player.id === playArea.clientId) {
      return player.entry;
    }
  }
  return undefined;
}

export function getPlayAreaPlayerName(playArea: PlayArea) {
  return getPlayAreaPlayerEntry(playArea)?.name || 'Player';
}
