import { players } from './globals';
import type { PlayArea } from './playArea';

export function getPlayAreaPlayerName(playArea: PlayArea) {
  for (const player of players()) {
    if (playArea.playerSessionId && player.entry.playerSessionId === playArea.playerSessionId) {
      return player.entry.name || 'Player';
    }
    if (player.id === playArea.clientId) {
      return player.entry.name || 'Player';
    }
  }
  return 'Player';
}
