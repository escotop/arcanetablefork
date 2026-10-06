import { createEffect } from 'solid-js';
import { createStore } from 'solid-js/store';
import { playAreas } from './globals';

type FlashTick = { id: number; delta: number };

const FLASH_MS = 920;

const [pendingBySeat, setPendingBySeat] = createStore<Record<number, FlashTick | undefined>>({});

let tickId = 0;

const previousLifeBySeat = new Map<number, number>();

function normalizeClientId(clientId: unknown): number | undefined {
  const id = Number(clientId);
  return Number.isFinite(id) ? id : undefined;
}

/** Map Yjs awareness client id + entry to play-area seat clientId. */
export function resolveSeatClientId(
  awarenessId: number,
  entry: Record<string, unknown> | undefined,
): number | undefined {
  const normalizedAwareness = normalizeClientId(awarenessId);
  if (normalizedAwareness !== undefined && playAreas[normalizedAwareness]) {
    return normalizedAwareness;
  }

  const sessionId = entry?.playerSessionId;
  if (typeof sessionId === 'string') {
    for (const area of Object.values(playAreas)) {
      if (area?.playerSessionId === sessionId) return area.clientId;
    }
  }

  if (normalizedAwareness !== undefined) {
    for (const area of Object.values(playAreas)) {
      if (area?.clientId === normalizedAwareness) return area.clientId;
    }
  }

  return undefined;
}

export function publishPlayerLifeDelta(seatClientId: number, delta: number) {
  if (!delta) return;
  const id = ++tickId;
  setPendingBySeat(seatClientId, { id, delta });
  window.setTimeout(() => {
    setPendingBySeat(seatClientId, current => (current?.id === id ? undefined : current));
  }, FLASH_MS);
}

export function syncLifeDeltasFromAwareness(
  states: Iterable<[number, Record<string, unknown>]>,
) {
  for (const [awarenessId, entry] of states) {
    const life = entry?.life;
    if (typeof life !== 'number') continue;

    const seatId = resolveSeatClientId(awarenessId, entry);
    if (seatId === undefined) continue;

    const prev = previousLifeBySeat.get(seatId);
    if (prev !== undefined && prev !== life) {
      publishPlayerLifeDelta(seatId, life - prev);
    }
    previousLifeBySeat.set(seatId, life);
  }
}

export function resetPlayerLifeDeltaTracking() {
  previousLifeBySeat.clear();
  setPendingBySeat({});
}

export function subscribePlayerLifeDeltaFlash(
  seatClientId: number | undefined,
  enabled: () => boolean,
  onDelta: (delta: number) => void,
) {
  createEffect(() => {
    if (!enabled() || seatClientId === undefined) return;
    const tick = pendingBySeat[seatClientId];
    if (tick) onDelta(tick.delta);
  });
}
