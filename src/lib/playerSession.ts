import { nanoid } from 'nanoid';
import { YArray } from 'yjs/dist/src/internals';

const STORAGE_PREFIX = 'arcanetable-player-session';
const JOIN_BINDING_PREFIX = 'arcanetable-join-binding';

export interface JoinBinding {
  playerSessionId: string;
  clientId: number;
}

type GameLogEvent = {
  type?: string;
  clientID?: number;
  events?: GameLogEvent[];
  payload?: { playerSessionId?: string; targetClientId?: number };
};

function hasActiveJoinForClientId(gameLog: YArray<unknown>, clientId: number): boolean {
  let active = false;
  for (const event of iterateGameLogEvents(gameLog)) {
    if (event?.type === 'kick' && Number(event.payload?.targetClientId) === Number(clientId)) {
      active = false;
    }
    if (event?.type === 'join' && Number(event.clientID) === Number(clientId)) {
      active = true;
    }
  }
  return active;
}

function resolveSessionClientIdFromLog(
  gameLog: YArray<unknown>,
  playerSessionId: string,
): number | undefined {
  let clientId: number | undefined;
  for (const event of iterateGameLogEvents(gameLog)) {
    if (event?.type === 'kick' && event.payload?.playerSessionId === playerSessionId) {
      clientId = undefined;
    }
    if (event?.type === 'join' && event.payload?.playerSessionId === playerSessionId) {
      clientId = Number(event.clientID);
    }
  }
  return clientId;
}

export function getOrCreatePlayerSessionId(gameId: string): string {
  const key = `${STORAGE_PREFIX}:${gameId}`;
  let sessionId = sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = nanoid();
    sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
}

export function persistJoinBinding(gameId: string, binding: JoinBinding) {
  sessionStorage.setItem(`${JOIN_BINDING_PREFIX}:${gameId}`, JSON.stringify(binding));
}

export function getStoredJoinBinding(gameId: string): JoinBinding | null {
  const raw = sessionStorage.getItem(`${JOIN_BINDING_PREFIX}:${gameId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JoinBinding;
  } catch {
    return null;
  }
}

export function clearJoinBinding(gameId: string) {
  sessionStorage.removeItem(`${JOIN_BINDING_PREFIX}:${gameId}`);
}

export function* iterateGameLogEvents(gameLog: YArray<unknown>): Generator<GameLogEvent> {
  for (let i = 0; i < gameLog.length; i++) {
    const srcEvent = gameLog.get(i) as GameLogEvent;
    if (srcEvent?.type === 'bulk' && srcEvent.events) {
      for (const event of srcEvent.events) {
        yield event;
      }
    } else if (srcEvent) {
      yield srcEvent;
    }
  }
}

export function findJoinClientIdForSession(
  gameLog: YArray<unknown>,
  playerSessionId: string,
): number | undefined {
  return resolveSessionClientIdFromLog(gameLog, playerSessionId);
}

export function findJoinClientIdForClientId(
  gameLog: YArray<unknown>,
  clientId: number,
): number | undefined {
  if (!hasActiveJoinForClientId(gameLog, clientId)) return undefined;
  return Number(clientId);
}

export async function resolveJoinClientId(
  gameLog: YArray<unknown>,
  gameId: string,
  playerSessionId: string,
  onPoll?: () => Promise<void>,
): Promise<number | undefined> {
  const stored = getStoredJoinBinding(gameId);

  const lookup = () =>
    findJoinClientIdForSession(gameLog, playerSessionId) ??
    (stored?.clientId !== undefined
      ? findJoinClientIdForClientId(gameLog, stored.clientId)
      : undefined);

  await onPoll?.();
  let joinClientId = lookup();
  if (joinClientId !== undefined) return joinClientId;

  const mayReconnect =
    !!stored || findJoinClientIdForSession(gameLog, playerSessionId) !== undefined;
  if (!mayReconnect) return undefined;

  for (let i = 0; i < 200; i++) {
    await onPoll?.();
    joinClientId = lookup();
    if (joinClientId !== undefined) return joinClientId;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lookup() ?? stored?.clientId;
}

const sessionToClientId = new Map<string, number>();

export function registerPlayerSession(playerSessionId: string, clientId: number) {
  if (!playerSessionId) return;
  sessionToClientId.set(playerSessionId, clientId);
}

export function unregisterPlayerSession(playerSessionId: string) {
  sessionToClientId.delete(playerSessionId);
}

export function getRegisteredClientIdForSession(playerSessionId: string) {
  return sessionToClientId.get(playerSessionId);
}

export function clearPlayerSessionRegistry() {
  sessionToClientId.clear();
}
