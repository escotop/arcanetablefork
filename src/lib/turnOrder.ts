import { createSignal } from 'solid-js';
import { gameLog, gameState, getLocalPlayerClientId, isEventCatchUpComplete, playAreas } from './globals';
import { iterateGameLogEvents } from './playerSession';
import { playTurnSound } from './sounds';

export interface TurnOrderState {
  order: number[];
  activeIndex: number;
}

const TURN_ORDER_KEY = 'turnOrder';

export const [turnOrderState, setTurnOrderState] = createSignal<TurnOrderState | null>(null);

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function getActivePlayAreaClientIds(): number[] {
  const activeJoins = new Set<number>();

  for (const event of iterateGameLogEvents(gameLog)) {
    if (event.type === 'kick') {
      const targetId = Number(event.payload?.targetClientId);
      if (Number.isFinite(targetId)) activeJoins.delete(targetId);
      continue;
    }
    if (event.type === 'join') {
      const clientId = Number(event.clientID);
      if (Number.isFinite(clientId)) activeJoins.add(clientId);
    }
  }

  return [...activeJoins]
    .filter(clientId => !!playAreas[clientId])
    .sort(
      (left, right) => (playAreas[left]?.index ?? 0) - (playAreas[right]?.index ?? 0),
    );
}

export function readTurnOrderState(): TurnOrderState | null {
  const raw = gameState?.get?.(TURN_ORDER_KEY) as TurnOrderState | undefined;
  if (!raw || !Array.isArray(raw.order)) return null;
  return raw;
}

export function writeTurnOrderState(state: TurnOrderState) {
  gameState.doc?.transact(() => {
    gameState.set(TURN_ORDER_KEY, state);
  });
}

export function sanitizeTurnOrder(
  state: TurnOrderState,
  activeIds: number[] = getActivePlayAreaClientIds(),
): TurnOrderState {
  const activeSet = new Set(activeIds);
  const order = state.order.filter(clientId => activeSet.has(clientId));

  for (const clientId of activeIds) {
    if (!order.includes(clientId)) order.push(clientId);
  }

  if (!order.length) {
    return { order: [], activeIndex: 0 };
  }

  const previousActive = state.order[state.activeIndex];
  let activeIndex = order.indexOf(previousActive);
  if (activeIndex < 0) {
    activeIndex = Math.min(state.activeIndex, order.length - 1);
  }

  return { order, activeIndex };
}

export function computeResetTurnOrderState(): TurnOrderState {
  const activeIds = getActivePlayAreaClientIds();
  if (!activeIds.length) {
    return { order: [], activeIndex: 0 };
  }

  return {
    order: shuffleArray(activeIds),
    activeIndex: 0,
  };
}

export function computeNextTurnState(): TurnOrderState {
  const activeIds = getActivePlayAreaClientIds();
  if (!activeIds.length) {
    return { order: [], activeIndex: 0 };
  }

  const current = readTurnOrderState();

  if (!current?.order.length) {
    return {
      order: shuffleArray(activeIds),
      activeIndex: 0,
    };
  }

  const sanitized = sanitizeTurnOrder(current);
  return {
    order: sanitized.order,
    activeIndex: (sanitized.activeIndex + 1) % sanitized.order.length,
  };
}

export function getActiveTurnClientId(state: TurnOrderState | null = turnOrderState()): number | undefined {
  if (!state?.order.length) return undefined;
  return state.order[state.activeIndex];
}

export function appendPlayerToTurnOrder(clientId: number) {
  const current = readTurnOrderState();
  if (!current?.order.length) return;

  if (current.order.includes(clientId)) return;

  const next = sanitizeTurnOrder({
    ...current,
    order: [...current.order, clientId],
  });
  writeTurnOrderState(next);
}

export function removePlayerFromTurnOrder(clientId: number) {
  const current = readTurnOrderState();
  if (!current?.order.length) return;

  const removedIndex = current.order.indexOf(clientId);
  if (removedIndex === -1) return;

  const order = current.order.filter(id => id !== clientId);
  if (!order.length) {
    gameState.doc?.transact(() => {
      gameState.delete(TURN_ORDER_KEY);
    });
    return;
  }

  let activeIndex = current.activeIndex;
  if (removedIndex < activeIndex) {
    activeIndex -= 1;
  } else if (removedIndex === activeIndex) {
    activeIndex = activeIndex % order.length;
  }
  if (activeIndex >= order.length) activeIndex = 0;

  writeTurnOrderState(sanitizeTurnOrder({ order, activeIndex }));
}

export function initTurnOrderSync() {
  let previousActive: number | undefined;
  let initialized = false;

  const sync = () => {
    const state = readTurnOrderState();
    setTurnOrderState(state);
    const active = getActiveTurnClientId(state);
    const localClientId = getLocalPlayerClientId();

    if (
      initialized &&
      isEventCatchUpComplete() &&
      active !== undefined &&
      active === localClientId &&
      active !== previousActive
    ) {
      playTurnSound();
    }

    initialized = true;
    previousActive = active;
  };

  sync();
  gameState.observe((event) => {
    // Solo reaccionar si el cambio afecta 'turnOrder'
    const changedKeys = Array.from(event.changes.keys.keys());
    if (!changedKeys.includes('turnOrder')) {
      return;
    }
    sync();
  });
}
