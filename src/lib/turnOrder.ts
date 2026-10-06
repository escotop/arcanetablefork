import { createSignal } from 'solid-js';
import {
  gameLog,
  gameState,
  getLocalPlayerClientId,
  isEventCatchUpComplete,
  isHistoricalLogReplayInProgress,
  playAreas,
} from './globals';
import { iterateGameLogEvents } from './playerSession';
import { playTurnSound } from './sounds';

export interface TurnOrderState {
  order: number[];
  activeIndex: number;
  round?: number;
}

function defaultRound(state?: Pick<TurnOrderState, 'round'> | null) {
  const round = state?.round;
  return typeof round === 'number' && round >= 1 ? round : 1;
}

function didCompleteRound(previous: TurnOrderState, next: TurnOrderState) {
  const length = previous.order.length;
  return length > 1 && previous.activeIndex === length - 1 && next.activeIndex === 0;
}

function deriveRoundFromPassTurnLog(): number {
  let round = 1;
  let previous: TurnOrderState | null = null;

  for (const event of iterateGameLogEvents(gameLog)) {
    if (event.type !== 'passTurn') continue;
    const next = event.payload?.turnOrder as TurnOrderState | undefined;
    if (!next?.order?.length) continue;
    if (typeof next.round === 'number' && next.round >= 1) {
      round = next.round;
      previous = next;
      continue;
    }
    if (previous && didCompleteRound(previous, next)) {
      round += 1;
    }
    previous = next;
  }

  return round;
}

export function getRoundNumber(state: TurnOrderState | null = turnOrderState()): number {
  return defaultRound(state);
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
    return { order: [], activeIndex: 0, round: defaultRound(state) };
  }

  const previousActive = state.order[state.activeIndex];
  let activeIndex = order.indexOf(previousActive);
  if (activeIndex < 0) {
    activeIndex = Math.min(state.activeIndex, order.length - 1);
  }

  return { order, activeIndex, round: defaultRound(state) };
}

export function computeResetTurnOrderState(): TurnOrderState {
  const activeIds = getActivePlayAreaClientIds();
  if (!activeIds.length) {
    return { order: [], activeIndex: 0, round: 1 };
  }

  return {
    order: shuffleArray(activeIds),
    activeIndex: 0,
    round: 1,
  };
}

export function computeNextTurnState(): TurnOrderState {
  const activeIds = getActivePlayAreaClientIds();
  if (!activeIds.length) {
    return { order: [], activeIndex: 0, round: 1 };
  }

  const current = readTurnOrderState();

  if (!current?.order.length) {
    return {
      order: shuffleArray(activeIds),
      activeIndex: 0,
      round: 1,
    };
  }

  const sanitized = sanitizeTurnOrder(current);
  const nextIndex = (sanitized.activeIndex + 1) % sanitized.order.length;
  const nextState = {
    order: sanitized.order,
    activeIndex: nextIndex,
    round: defaultRound(sanitized),
  };

  if (didCompleteRound(sanitized, nextState)) {
    nextState.round += 1;
  }

  return nextState;
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

function lastPassTurnFromLog(): TurnOrderState | null {
  let last: TurnOrderState | null = null;
  for (const event of iterateGameLogEvents(gameLog)) {
    if (event.type !== 'passTurn') continue;
    const turnOrder = event.payload?.turnOrder as TurnOrderState | undefined;
    if (turnOrder && Array.isArray(turnOrder.order)) {
      last = turnOrder;
    }
  }
  return last;
}

/** Apply current turn once after log replay — passTurn events are not replayed step-by-step. */
export function syncTurnOrderAfterLogReplay() {
  const persisted = readTurnOrderState();
  if (persisted?.order.length) {
    let next = sanitizeTurnOrder(persisted);
    if (next.round == null) {
      next = { ...next, round: deriveRoundFromPassTurnLog() };
      writeTurnOrderState(next);
    }
    setTurnOrderState(readTurnOrderState());
    syncBattlefieldTurnOutlineHighlight();
    return;
  }

  const fromLog = lastPassTurnFromLog();
  if (!fromLog?.order.length) {
    setTurnOrderState(null);
    syncBattlefieldTurnOutlineHighlight();
    return;
  }

  let next = sanitizeTurnOrder(fromLog);
  if (next.round == null) {
    next = { ...next, round: deriveRoundFromPassTurnLog() };
    writeTurnOrderState(next);
  } else {
    writeTurnOrderState(next);
  }
  setTurnOrderState(readTurnOrderState());
  syncBattlefieldTurnOutlineHighlight();
}

export function shouldApplyPassTurnFromLogEvent() {
  return isEventCatchUpComplete() && !isHistoricalLogReplayInProgress();
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

export function syncBattlefieldTurnOutlineHighlight() {
  const activeId = getActiveTurnClientId();
  for (const area of Object.values(playAreas)) {
    if (!area) continue;
    const isActive = activeId !== undefined && area.clientId === activeId;
    area.battlefieldZone.setTurnOutlineHighlight(isActive);
  }
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
      !isHistoricalLogReplayInProgress() &&
      active !== undefined &&
      active === localClientId &&
      active !== previousActive
    ) {
      playTurnSound();
    }

    initialized = true;
    previousActive = active;
    syncBattlefieldTurnOutlineHighlight();
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
