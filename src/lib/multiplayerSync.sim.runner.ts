import { Group } from 'three';
import { renderAnimations } from './animations';
import { cardFromDeckEntry } from './cardLoading';
import { createDeckDrawLogEvent, createTransferCardEvent } from './createEvents';
import { Card } from './constants';
import {
  clock,
  dispatchGameEvent,
  finishHistoricalLogReplay,
  flushDispatchEventQueue,
  gameLog,
  headlessInit,
  playAreas,
  processedEvents,
  resetGameSceneForReplay,
  sendEvent,
  setEventCatchUpComplete,
  setGameTable,
  setLocalPlayerClientId,
  setPlayAreas,
  setProcessedEvents,
  table,
} from './globals';
import { PlayArea } from './playArea';
import { transferCard } from './transferCard';
import { processEvents, syncPlayAreasFromGameLog } from '../remoteEvents';

export const CLIENT_A = 10_001;
export const CLIENT_B = 10_002;
const DECK_SIZE = 40;
export const MAX_SYNC_STRESS_ACTIONS = 200;

export type SeatFingerprint = {
  clientId: number;
  handCount: number;
  handIds: string[];
  battlefieldIds: string[];
  graveyardIds: string[];
  deckCount: number;
  tappedBattlefieldIds: string[];
};

export type WorldFingerprint = {
  seats: SeatFingerprint[];
  gameLogLength: number;
  processedEvents: number;
};

export type SyncStressResult =
  | { ok: true; actionsCompleted: number; logLength: number }
  | {
      ok: false;
      actionIndex: number;
      kind: string;
      actorId: number;
      diagnosis: string;
      lastEvent?: unknown;
    };

function createSharedGameLog() {
  const entries: unknown[] = [];
  const observers = new Set<() => void>();
  return {
    push(items: unknown[]) {
      entries.push(...items);
      observers.forEach(fn => fn());
      return items.length;
    },
    get(index: number) {
      return entries[index];
    },
    get length() {
      return entries.length;
    },
    set length(_value: number) {
      // noop
    },
    observe(fn: () => void) {
      observers.add(fn);
    },
    unobserve(fn: () => void) {
      observers.delete(fn);
    },
    toArray() {
      return entries.slice();
    },
  };
}

function createDeckCards(prefix: string, clientId: number): Card[] {
  return Array.from({ length: DECK_SIZE }, (_, i) => {
    const name = `${prefix} Card ${i}`;
    const entry = {
      id: `${prefix}-id-${i}`,
      name,
      qty: 1,
      categories: [] as string[],
      set: 'TST',
      collector_number: String(i),
      detail: { name, set: 'TST', collector_number: String(i) },
    };
    const card = cardFromDeckEntry(entry, clientId);
    card.id = `${prefix}-id-${i}`;
    return card;
  });
}

function fingerprintWorld(): WorldFingerprint {
  const seats = Object.values(playAreas)
    .filter((area): area is PlayArea => !!area)
    .map(area => ({
      clientId: area.clientId,
      handCount: area.hand.cards.length,
      handIds: area.hand.cards.map(card => card.id).sort(),
      battlefieldIds: area.battlefieldZone.cards.map(card => card.id).sort(),
      graveyardIds: area.graveyardZone.cards.map(card => card.id).sort(),
      deckCount: area.deck.cards.length,
      tappedBattlefieldIds: area.battlefieldZone.cards
        .filter(card => card.mesh?.userData?.isTapped)
        .map(card => card.id)
        .sort(),
    }))
    .sort((left, right) => left.clientId - right.clientId);

  return {
    seats,
    gameLogLength: gameLog.length,
    processedEvents: processedEvents(),
  };
}

export function diffFingerprints(
  asClientA: WorldFingerprint,
  asClientB: WorldFingerprint,
): string | undefined {
  if (JSON.stringify(asClientA) === JSON.stringify(asClientB)) return undefined;

  const lines: string[] = [
    'El mismo gameLog reproduce mundos distintos según localClientId (como dos navegadores).',
  ];
  const seatIds = new Set([
    ...asClientA.seats.map(s => s.clientId),
    ...asClientB.seats.map(s => s.clientId),
  ]);

  for (const clientId of [...seatIds].sort((a, b) => a - b)) {
    const a = asClientA.seats.find(s => s.clientId === clientId);
    const b = asClientB.seats.find(s => s.clientId === clientId);
    if (!a || !b) {
      lines.push(`Asiento ${clientId}: falta en un replay (A=${!!a}, B=${!!b})`);
      continue;
    }
    if (a.handCount !== b.handCount) {
      lines.push(`Asiento ${clientId} mano: ${a.handCount} vs ${b.handCount} cartas`);
    }
    if (a.deckCount !== b.deckCount) {
      lines.push(`Asiento ${clientId} mazo: ${a.deckCount} vs ${b.deckCount}`);
    }
    if (JSON.stringify(a.battlefieldIds) !== JSON.stringify(b.battlefieldIds)) {
      lines.push(
        `Asiento ${clientId} tablero: [${a.battlefieldIds.join(', ')}] vs [${b.battlefieldIds.join(', ')}]`,
      );
    }
    if (JSON.stringify(a.graveyardIds) !== JSON.stringify(b.graveyardIds)) {
      lines.push(
        `Asiento ${clientId} cementerio: [${a.graveyardIds.join(', ')}] vs [${b.graveyardIds.join(', ')}]`,
      );
    }
    if (JSON.stringify(a.tappedBattlefieldIds) !== JSON.stringify(b.tappedBattlefieldIds)) {
      lines.push(
        `Asiento ${clientId} giradas: [${a.tappedBattlefieldIds.join(', ')}] vs [${b.tappedBattlefieldIds.join(', ')}]`,
      );
    }
  }

  lines.push(
    `Log length=${asClientA.gameLogLength}, processed replay-as-A=${asClientA.processedEvents} replay-as-B=${asClientB.processedEvents}`,
  );
  return lines.join('\n');
}

let sharedLog = createSharedGameLog();
let animationTimer: ReturnType<typeof setTimeout> | undefined;

function mockProvider(localClientId: number) {
  const states = new Map<number, Record<string, unknown>>();
  return {
    awareness: {
      clientID: localClientId,
      getStates: () => states,
      getLocalState: () => states.get(localClientId),
      setLocalStateField: (key: string, value: unknown) => {
        const entry = states.get(localClientId) ?? {};
        entry[key] = value;
        states.set(localClientId, entry);
      },
    },
  };
}

function startAnimationLoop() {
  if (!clock) return;
  let time = 0;
  const tick = () => {
    renderAnimations(time);
    time += 1000;
    animationTimer = setTimeout(tick, 10);
  };
  tick();
}

function stopAnimationLoop() {
  if (animationTimer) clearTimeout(animationTimer);
  animationTimer = undefined;
}

async function installWorld(localClientId: number, logEntries: unknown[]) {
  resetGameSceneForReplay();
  sharedLog = createSharedGameLog();
  for (const entry of logEntries) {
    sharedLog.push([structuredClone(entry)]);
  }

  headlessInit({
    provider: mockProvider(localClientId),
    gameLog: sharedLog,
  });

  setGameTable(new Group());
  setEventCatchUpComplete(false);
  setLocalPlayerClientId(localClientId);
  setProcessedEvents(0);

  syncPlayAreasFromGameLog();
  await processEvents();
  finishHistoricalLogReplay();
  setEventCatchUpComplete(true);
}

async function replayLogAs(localClientId: number, logEntries: unknown[]) {
  await installWorld(localClientId, logEntries);
  return fingerprintWorld();
}

async function joinPlayer(clientId: number, sessionId: string, prefix: string) {
  setLocalPlayerClientId(clientId);
  const cards = createDeckCards(prefix, clientId);
  const playArea = new PlayArea(
    clientId,
    cards.map(c => ({ id: c.id, name: c.detail?.name ?? c.id })),
    cards,
    {
      isLocalPlayer: true,
      index: clientId === CLIENT_A ? 0 : 1,
      playerSessionId: sessionId,
    },
  );

  table.add(playArea.mesh);
  setPlayAreas(clientId, playArea);

  sendEvent({
    type: 'join',
    payload: playArea.getLocalState(),
  });

  await flushDispatchEventQueue();
  await processEvents();
}

type ActionKind = 'draw' | 'play' | 'tap' | 'graveyard';

async function performDraw(actorId: number) {
  setLocalPlayerClientId(actorId);
  const area = playAreas[actorId];
  if (!area?.deck.cards.length) throw new Error('draw: empty deck');
  area.deck.materializeTopCard();
  const card = area.deck.cards[0];
  if (!card) throw new Error('draw: no card');
  dispatchGameEvent(createDeckDrawLogEvent({ source: 'top' }));
  await transferCard(card, area.deck, area.hand);
  await flushDispatchEventQueue();
  await processEvents();
}

async function performPlayToBattlefield(actorId: number) {
  setLocalPlayerClientId(actorId);
  const area = playAreas[actorId];
  const card = area.hand.cards[0];
  if (!card) throw new Error('play: empty hand');

  const transferEvent = createTransferCardEvent(card, area.hand, area.battlefieldZone, {
    addOptions: { positionArray: [0, 0, 0] },
  });
  const extended = transferEvent.payload.extendedOptions;
  await transferCard(card, area.hand, area.battlefieldZone, {
    preventTransmit: true,
    localSounds: false,
    addOptions: extended?.addOptions,
    userData: extended?.userData,
  });
  dispatchGameEvent(transferEvent);
  await flushDispatchEventQueue();
  await processEvents();
}

async function performTap(actorId: number) {
  setLocalPlayerClientId(actorId);
  const area = playAreas[actorId];
  const card =
    area.battlefieldZone.cards.find(c => !c.mesh?.userData?.isTapped) ??
    area.battlefieldZone.cards[0];
  if (!card?.mesh) throw new Error('tap: no battlefield card');
  await area.tap(card.mesh, { skipAnimation: true });
  await flushDispatchEventQueue();
  await processEvents();
}

async function performSendToGraveyard(actorId: number) {
  setLocalPlayerClientId(actorId);
  const area = playAreas[actorId];
  const card = area.battlefieldZone.cards[0] ?? area.hand.cards[0];
  if (!card) throw new Error('graveyard: no card');
  const fromZone = area.battlefieldZone.cards.includes(card)
    ? area.battlefieldZone
    : area.hand;

  const transferEvent = createTransferCardEvent(card, fromZone, area.graveyardZone, {});
  const extended = transferEvent.payload.extendedOptions;
  await transferCard(card, fromZone, area.graveyardZone, {
    preventTransmit: true,
    localSounds: false,
    addOptions: extended?.addOptions,
    userData: extended?.userData,
  });
  dispatchGameEvent(transferEvent);
  await flushDispatchEventQueue();
  await processEvents();
}

function pickAction(actionIndex: number, actorId: number): ActionKind {
  const area = playAreas[actorId];
  if (!area) return 'draw';

  const options: ActionKind[] = [];
  if (area.deck.cards.length > 0) options.push('draw');
  if (area.hand.cards.length > 0) options.push('play', 'graveyard');
  if (area.battlefieldZone.cards.length > 0) options.push('tap', 'graveyard');

  if (!options.length) return 'draw';
  return options[actionIndex % options.length];
}

declare global {
  // eslint-disable-next-line no-var
  var __SYNC_STRESS_FAST: boolean | undefined;
}

export async function runMultiplayerSyncStress(
  maxActions = MAX_SYNC_STRESS_ACTIONS,
): Promise<SyncStressResult> {
  globalThis.__SYNC_STRESS_FAST = true;
  sharedLog = createSharedGameLog();
  startAnimationLoop();

  try {
    await installWorld(CLIENT_A, []);
    await joinPlayer(CLIENT_A, 'session-a', 'A');
    await joinPlayer(CLIENT_B, 'session-b', 'B');

    let completed = 0;

    for (let actionIndex = 0; actionIndex < maxActions; actionIndex++) {
      const actorId = actionIndex % 2 === 0 ? CLIENT_A : CLIENT_B;
      const kind = pickAction(actionIndex, actorId);

      try {
        switch (kind) {
          case 'draw':
            await performDraw(actorId);
            break;
          case 'play':
            await performPlayToBattlefield(actorId);
            break;
          case 'tap':
            await performTap(actorId);
            break;
          case 'graveyard':
            await performSendToGraveyard(actorId);
            break;
        }
      } catch (error) {
        if (process.env.SYNC_STRESS_VERBOSE) {
          console.warn(`action ${actionIndex} ${kind} actor ${actorId}:`, error);
        }
        continue;
      }

      if (processedEvents() !== gameLog.length) {
        return {
          ok: false,
          actionIndex,
          kind,
          actorId,
          diagnosis: `processedEvents (${processedEvents()}) !== gameLog.length (${gameLog.length}) tras la acción.`,
        };
      }

      completed++;
    }

    const finalLog = sharedLog.toArray();
    if (process.env.SYNC_STRESS_PROGRESS) {
      console.info(
        `[sync-stress] simulación: ${completed} acciones; verificando replay A/B (log ${finalLog.length})…`,
      );
    }
    const asA = await replayLogAs(CLIENT_A, finalLog);
    const asB = await replayLogAs(CLIENT_B, finalLog);
    const diff = diffFingerprints(asA, asB);
    if (diff) {
      return {
        ok: false,
        actionIndex: Math.max(0, completed - 1),
        kind: 'final-replay',
        actorId: CLIENT_A,
        diagnosis: diff,
        lastEvent: finalLog[finalLog.length - 1],
      };
    }

    return { ok: true, actionsCompleted: completed, logLength: gameLog.length };
  } finally {
    globalThis.__SYNC_STRESS_FAST = undefined;
    stopAnimationLoop();
  }
}
