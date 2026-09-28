import { getActiveJoinClientIdsFromLog } from '../remoteEvents';
import { playAreas } from './globals';
import { getPlayAreaPlayerName, resolveLogPlayerName } from './playAreaNameTag';

export function normalizePlayerNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Display names of players currently seated in this game (not kicked). */
export function getSeatedPlayerDisplayNames(): string[] {
  const seenKeys = new Set<string>();
  const names: string[] = [];

  const add = (raw: string | undefined) => {
    const trimmed = raw?.trim();
    if (!trimmed) return;
    const key = normalizePlayerNameKey(trimmed);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    names.push(trimmed);
  };

  for (const clientId of getActiveJoinClientIdsFromLog()) {
    add(resolveLogPlayerName(clientId));
  }

  for (const area of Object.values(playAreas)) {
    if (!area) continue;
    add(getPlayAreaPlayerName(area));
  }

  return names;
}

export function isPlayerNameTaken(
  candidateName: string,
  options?: { exceptNormalizedKey?: string },
): boolean {
  const candidateKey = normalizePlayerNameKey(candidateName);
  if (!candidateKey) return false;
  if (options?.exceptNormalizedKey && candidateKey === options.exceptNormalizedKey) {
    return false;
  }

  return getSeatedPlayerDisplayNames().some(
    seated => normalizePlayerNameKey(seated) === candidateKey,
  );
}

export const PLAYER_NAME_TAKEN_MESSAGE =
  'That name is already taken by another player in this game.';
