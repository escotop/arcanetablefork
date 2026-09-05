import uniqBy from 'lodash-es/uniqBy';
import { nanoid } from 'nanoid';
import { Object3D, Vector3 } from 'three';
import { animateObject, queueAnimationGroup, rehydrateAnimation } from './lib/animations';
import {
  applyCardOrientation,
  cloneCard,
  splitUserdata,
  setCardData,
  ensureCardMesh,
  loadCardTextures,
  updateModifiers,
} from './lib/card';
import { Card } from './lib/constants';
import * as Sentry from '@sentry/solidstart';
import {
  applyPlayerTransform,
  cardsById,
  createAnnouncement,
  drainResolvers,
  expect,
  gameLog,
  logger,
  logs,
  onConcede,
  onKickPlayer,
  getLocalPlayArea,
  getLocalPlayerClientId,
  playAreas,
  players,
  processedEvents,
  provider,
  setLogs,
  setPlayAreas,
  setPlayerCount,
  setProcessedEvents,
  table,
  zonesById,
  isGameStateImportInProgress,
  isEventCatchUpComplete,
  isHistoricalLogReplayInProgress,
  resetGameSceneForReplay,
} from './lib/globals';
import { PlayArea } from './lib/playArea';
import { Deck } from './lib/deck';
import { transferCard } from './lib/transferCard';
import { setCounters } from './lib/ui/counterDialog';
import { isLogMessageStackable } from './lib/ui/log';
import * as EventCreators from './lib/createEvents';
import { restackItems } from './lib/utils';
import { readjustPlayAreas } from './main3d';
import {
  getRegisteredClientIdForSession,
  registerPlayerSession,
  iterateGameLogEvents,
} from './lib/playerSession';
import {
  playCounterSoundForModifierChange,
  playDrawSound,
  playPlayCardSound,
  playShuffleDeckSound,
  playTapSound,
} from './lib/sounds';
import {
  isLoadProfiling,
  profileReplayHandle,
  recordReplayBatch,
  recordReplayDelay,
  recordReplaySkip,
} from './lib/loadProfile';

type Events = ReturnType<(typeof EventCreators)[keyof typeof EventCreators]>;
type Event = { clientID: string; skipReplay?: boolean } & Events;

let events = [];
let timing = 100;
let processEventsChain: Promise<void> = Promise.resolve();

function shouldSkipLocallyAppliedEvent(event: { clientID?: number; locallyApplied?: boolean }) {
  if (isHistoricalLogReplayInProgress()) return false;
  if (!event.locallyApplied || !isEventCatchUpComplete()) return false;
  const localClientId = getLocalPlayerClientId();
  return localClientId !== undefined && event.clientID === localClientId;
}

function isSilentTransferEvent(event: { type?: string; payload?: Record<string, unknown> }) {
  if (event.type !== 'transferCard') return false;
  const extendedOptions = event.payload?.extendedOptions as
    | { addOptions?: { skipAnimation?: boolean } }
    | undefined;
  if (!extendedOptions?.addOptions?.skipAnimation) return false;

  const fromZoneId = event.payload?.fromZoneId as string | undefined;
  const fromZone = fromZoneId ? zonesById.get(fromZoneId) : undefined;
  return fromZone?.zone === 'peek' || fromZone?.zone === 'tokenSearch';
}

function isDeckToPeekTransfer(event: { type?: string; payload?: Record<string, unknown> }) {
  if (event.type !== 'transferCard') return false;

  const fromZoneId = event.payload?.fromZoneId as string | undefined;
  const toZoneId = event.payload?.toZoneId as string | undefined;
  const fromZone = fromZoneId ? zonesById.get(fromZoneId) : undefined;
  const toZone = toZoneId ? zonesById.get(toZoneId) : undefined;
  return fromZone?.zone === 'deck' && toZone?.zone === 'peek';
}

function isSearchOrDismissReplayEvent(event: {
  type?: string;
  skipReplay?: boolean;
  payload?: Record<string, unknown>;
}) {
  if (event.skipReplay) return true;
  if (event.type === 'peekCards' || event.type === 'dismissZone' || event.type === 'mulligan') return true;
  if (event.type === 'transferEntireZone') {
    const fromZoneId = event.payload?.fromZoneId as string | undefined;
    const fromZone = fromZoneId ? zonesById.get(fromZoneId) : undefined;
    return fromZone?.zone === 'peek' || fromZone?.zone === 'tokenSearch';
  }
  return isDeckToPeekTransfer(event) || isSilentTransferEvent(event);
}

function shouldSkipEventOnCatchUp(event: {
  type?: string;
  skipReplay?: boolean;
  payload?: Record<string, unknown>;
}) {
  if (isHistoricalLogReplayInProgress()) return false;
  return !isEventCatchUpComplete() && isSearchOrDismissReplayEvent(event);
}

function isEphemeralEvent(event: { type?: string; payload?: Record<string, unknown> }) {
  return (
    event.type === 'animateObject' ||
    event.type === 'waterdrop' ||
    event.type === 'dismissZone' ||
    event.type === 'transferEntireZone' ||
    event.type === 'peekCards' ||
    event.type === 'restack' ||
    isDeckToPeekTransfer(event) ||
    isSilentTransferEvent(event)
  );
}

function shouldSkipEventTiming(event: { type?: string; payload?: Record<string, unknown> }) {
  return isEphemeralEvent(event) || !isEventCatchUpComplete();
}

async function tryBatchReplayEvent(
  event: Event,
  pending: Event[],
  playArea?: PlayArea,
): Promise<boolean> {
  if (!playArea) return false;

  if (event.type === 'peekCards') {
    const fromZone = resolveZoneFromEvent(event.payload.fromZoneId, playArea);
    const toZone = resolveZoneFromEvent(event.payload.toZoneId, playArea);
    if (!fromZone || !toZone) return false;
    await playArea.executePeekCards(fromZone, toZone, event.payload.count, {
      skipAnimation: event.payload.skipAnimation ?? event.payload.count > 5,
    });
    return true;
  }

  if (isDeckToPeekTransfer(event)) {
    let count = 1;
    while (
      pending.length > 0 &&
      isDeckToPeekTransfer(pending[0]) &&
      pending[0].clientID === event.clientID
    ) {
      pending.shift();
      count++;
    }
    const fromZone = resolveZoneFromEvent(event.payload.fromZoneId as string, playArea);
    const toZone = resolveZoneFromEvent(event.payload.toZoneId as string, playArea);
    if (!fromZone || !toZone) return false;
    await playArea.executePeekCards(fromZone, toZone, count, { skipAnimation: true });
    return true;
  }

  if (isSilentTransferEvent(event)) {
    const fromZone = resolveZoneFromEvent(event.payload.fromZoneId as string, playArea);
    if (!fromZone || (fromZone.zone !== 'peek' && fromZone.zone !== 'tokenSearch')) {
      return false;
    }

    const toZoneId = event.payload?.toZoneId as string | undefined;
    while (
      pending.length > 0 &&
      isSilentTransferEvent(pending[0]) &&
      pending[0].clientID === event.clientID &&
      pending[0].payload?.fromZoneId === fromZone.id &&
      pending[0].payload?.toZoneId === toZoneId
    ) {
      pending.shift();
    }

    const toZone = toZoneId ? resolveZoneFromEvent(toZoneId, playArea) : undefined;
    const addOptions = (
      event.payload?.extendedOptions as
        | { addOptions?: { location?: 'top' | 'bottom'; skipAnimation?: boolean } }
        | undefined
    )?.addOptions;

    if (toZone) {
      await playArea.executeTransferEntireZone(fromZone, toZone, {
        skipAnimation: true,
        ...addOptions,
      });
    } else {
      await playArea.executeDismissZone(fromZone);
    }
    return true;
  }

  return false;
}

async function drainProcessEvents() {
  if (isGameStateImportInProgress()) return;
  if (processedEvents() > gameLog.length) {
    resetGameSceneForReplay();
  }

  while (processedEvents() < gameLog.length) {
    const srcEvent = gameLog.get(processedEvents());
    setProcessedEvents(e => e + 1);

    if (shouldSkipLocallyAppliedEvent(srcEvent)) {
      if (isLoadProfiling()) recordReplaySkip('local');
      continue;
    }

    if (srcEvent.type === 'bulk') {
      timing = srcEvent.timing;
      events = srcEvent.events
        .map(e => {
          e.clientID = srcEvent.clientID;
          e.locallyApplied = srcEvent.locallyApplied;
          return e;
        })
        .filter(e => !shouldSkipEventOnCatchUp(e));
      if (isLoadProfiling()) recordReplayBatch(events.length);
      if (!events.length) continue;
    } else {
      if (shouldSkipEventOnCatchUp(srcEvent)) {
        if (isLoadProfiling()) recordReplaySkip('catchUp');
        continue;
      }
      timing = 25;
      events = [srcEvent];
    }

    while (events.length > 0) {
      let event = events.shift();
      if (shouldSkipEventOnCatchUp(event)) {
        if (isLoadProfiling()) recordReplaySkip('catchUp');
        continue;
      }
      try {
        addLogMessage(event);
      } catch (e) {
        Sentry.captureException(e, 'addLogMessage');
        logger.error(e);
      }
      if (shouldSkipLocallyAppliedEvent(event)) {
        if (isLoadProfiling()) recordReplaySkip('local');
        continue;
      }
      if (event.type === 'waterdrop') continue;
      const clientID = Number(event.clientID);
      let playArea = Number.isFinite(clientID) ? playAreas[clientID] : undefined;
      if (isLoadProfiling()) {
        if (await profileReplayHandle(event.type, () => tryBatchReplayEvent(event, events, playArea))) {
          continue;
        }
        await profileReplayHandle(event.type, () => handleEvent(event, playArea));
      } else {
        if (await tryBatchReplayEvent(event, events, playArea)) continue;
        await handleEvent(event, playArea);
      }
      if (events.length > 0 && !shouldSkipEventTiming(event)) {
        if (isLoadProfiling()) recordReplayDelay(timing);
        await new Promise(resolve => setTimeout(resolve, timing));
      }
    }
  }
}

export function processEvents(): Promise<void> {
  processEventsChain = processEventsChain
    .then(() => drainProcessEvents())
    .catch(error => {
      Sentry.captureException(error);
      logger.error(error);
    })
    .finally(() => {
      drainResolvers.splice(0).forEach(r => r());
    });
  return processEventsChain;
}

export async function waitForGameLogCatchUp(options?: { maxWaitMs?: number }) {
  const deadline = performance.now() + (options?.maxWaitMs ?? 30_000);

  while (performance.now() < deadline) {
    await processEvents();
    if (processedEvents() >= gameLog.length) {
      await new Promise<void>(requestAnimationFrame);
      if (processedEvents() >= gameLog.length) return true;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }

  return processedEvents() >= gameLog.length;
}

const USERDATA_BLOCK_LIST = ['cardBack', 'publicCardBack'];

function shouldSyncOrientationFromEvents() {
  return !isEventCatchUpComplete() || isHistoricalLogReplayInProgress();
}

function applyEventUserData(card: Card, userData: Record<string, unknown>) {
  if (!card.mesh) return;
  const { id, ...fields } = userData;
  const orientationChanged = 'isTapped' in fields || 'isFlipped' in fields;
  Object.entries(fields).forEach(([key, value]) => {
    if (USERDATA_BLOCK_LIST.includes(key)) return;
    setCardData(card.mesh!, key, value);
  });
  if (
    orientationChanged &&
    card.mesh.userData.location === 'battlefield' &&
    shouldSyncOrientationFromEvents()
  ) {
    applyCardOrientation(card.mesh);
  }
}

function resolveEventCard(cardId: string | undefined, playArea?: PlayArea): Card | undefined {
  if (cardId == null || cardId === '') return undefined;
  const id = String(cardId);

  let card = cardsById.get(id);
  if (card) return card;

  const playAreasToSearch = playArea
    ? [playArea, ...Object.values(playAreas).filter(area => area && area !== playArea)]
    : Object.values(playAreas).filter(Boolean);

  for (const area of playAreasToSearch) {
    const zones = [
      area.deck,
      area.hand,
      area.battlefieldZone,
      area.graveyardZone,
      area.exileZone,
      area.peekZone,
      area.revealZone,
      area.tokenSearchZone,
    ];

    for (const zone of zones) {
      card = zone.cards?.find(entry => entry.id === id || String(entry.id) === id);
      if (card) {
        cardsById.set(card.id, card);
        return card;
      }
    }
  }

  return undefined;
}

function resolveAnimationTarget(
  targetId: string | undefined,
  playArea?: PlayArea,
): Object3D | undefined {
  if (targetId == null || targetId === '') return undefined;
  const id = String(targetId);

  const card = ensureCardReady(resolveEventCard(id, playArea), playArea?.clientId);
  if (card?.mesh) return card.mesh;

  const zone = zonesById.get(id);
  if (zone?.mesh) return zone.mesh;

  return undefined;
}

function resolveZoneFromEvent(zoneId: string | undefined, playArea?: PlayArea) {
  if (!zoneId) return undefined;

  const zone = zonesById.get(zoneId);
  if (zone) return zone;

  if (!playArea) return undefined;

  const playAreaZones = [
    playArea.deck,
    playArea.hand,
    playArea.battlefieldZone,
    playArea.graveyardZone,
    playArea.exileZone,
    playArea.peekZone,
    playArea.revealZone,
    playArea.tokenSearchZone,
  ];

  return playAreaZones.find(entry => entry.id === zoneId);
}

function isCardInZone(card: Card, zone?: { cards?: Card[] }) {
  if (!zone?.cards || !card) return false;
  return zone.cards.some(entry => entry.id === card.id || String(entry.id) === String(card.id));
}

function findZoneContainingCard(card: Card, playArea?: PlayArea) {
  if (!playArea) return undefined;

  const zones = [
    playArea.deck,
    playArea.hand,
    playArea.battlefieldZone,
    playArea.graveyardZone,
    playArea.exileZone,
    playArea.peekZone,
    playArea.revealZone,
    playArea.tokenSearchZone,
  ];

  return zones.find(zone => isCardInZone(card, zone));
}

function ensureCardReady(card: Card | undefined, clientId?: number): Card | undefined {
  if (!card) return undefined;
  const ownerId = clientId ?? card.clientId;
  if (!card.mesh && ownerId !== undefined) {
    ensureCardMesh(card, ownerId);
  }
  return card;
}

export async function handleEvent(event: Event, playArea: PlayArea) {
  expect(!!EVENTS[event.type], `${event.type} not implemented`);

  if (event.type === 'animateObject') {
    await EVENTS.animateObject(event, playArea);
    return;
  }

  if (
    event.type === 'dismissZone' ||
    event.type === 'transferEntireZone' ||
    event.type === 'peekCards' ||
    event.type === 'deleteClone'
  ) {
    await EVENTS[event.type](event, playArea);
    return;
  }

  let cardId = event.payload?.userData?.id;
  let card = resolveEventCard(cardId, playArea);

  if (event.payload?.userData?.isLocalOnly && event.clientID !== getLocalPlayerClientId()) {
    return;
  }

  if (cardId && !card && event.type !== 'createCard') {
    Sentry.captureException(new Error('card is undefined'), {
      tags: { event_type: event.type },
      extra: { missingId: cardId, knownIdCount: cardsById.size, payload: event.payload },
    });
  }

  if (card && event.type !== 'transferCard') {
    card = ensureCardReady(card, playArea?.clientId) ?? card;
  }

  if (card?.mesh && event.payload?.userData && event.type !== 'transferCard') {
    applyEventUserData(card, event.payload.userData);
  }
  if (!isEphemeralEvent(event)) {
    logger.log('[handleEvents]', ...arguments);
  }
  await EVENTS[event.type](event, playArea, card);
}

function normalizeClientId(clientId: unknown): number | undefined {
  const id = Number(clientId);
  return Number.isFinite(id) ? id : undefined;
}

function removeRemotePlayArea(clientId: number) {
  const playArea = playAreas[clientId];
  if (!playArea || playArea.isLocalPlayArea) return;

  table.remove(playArea.mesh);
  playArea.destroy();
  setPlayAreas(clientId, undefined);
  setPlayerCount(count => Math.max(0, count - 1));
}

function applyJoinEvent(event: Event) {
  const clientID = normalizeClientId(event.clientID);
  if (clientID === undefined) return false;
  const existing = playAreas[clientID];
  if (existing) {
    if (existing.mesh.parent !== table) {
      table.add(existing.mesh);
      readjustPlayAreas();
    }
    return false;
  }

  const playerSessionId = event.payload?.playerSessionId as string | undefined;
  if (playerSessionId) {
    const existingClientId = getRegisteredClientIdForSession(playerSessionId);
    if (existingClientId !== undefined && existingClientId !== clientID) {
      const existingArea = playAreas[existingClientId];
      if (existingArea?.isLocalPlayArea) return false;
      removeRemotePlayArea(existingClientId);
    }
    registerPlayerSession(playerSessionId, clientID);
  }

  const playArea = PlayArea.FromNetworkState({ ...event.payload, clientID, clientId: clientID });
  playArea.playerSessionId = playerSessionId;

  table.add(playArea.mesh);
  setPlayAreas(clientID, playArea);
  setPlayerCount(count => count + 1);
  readjustPlayAreas();
  return true;
}

export function syncPlayAreasFromGameLog() {
  const activeJoins = new Map<number, Event>();

  for (const rawEvent of iterateGameLogEvents(gameLog)) {
    if (rawEvent.type === 'kick') {
      const targetId = normalizeClientId(rawEvent.payload?.targetClientId);
      if (targetId !== undefined) activeJoins.delete(targetId);
      continue;
    }

    if (rawEvent.type !== 'join') continue;

    const clientID = normalizeClientId(rawEvent.clientID);
    if (clientID === undefined) continue;

    activeJoins.set(clientID, { ...rawEvent, clientID } as Event);
  }

  for (const event of activeJoins.values()) {
    applyJoinEvent(event);
  }
}

export function getActiveJoinClientIdsFromLog(): Set<number> {
  const activeJoins = new Set<number>();

  for (const rawEvent of iterateGameLogEvents(gameLog)) {
    if (rawEvent.type === 'kick') {
      const targetId = normalizeClientId(rawEvent.payload?.targetClientId);
      if (targetId !== undefined) activeJoins.delete(targetId);
      continue;
    }

    if (rawEvent.type !== 'join') continue;

    const clientID = normalizeClientId(rawEvent.clientID);
    if (clientID !== undefined) activeJoins.add(clientID);
  }

  return activeJoins;
}

export function countRemoteJoinsMissingPlayAreas(localClientId?: number): number {
  let missing = 0;

  for (const clientId of getActiveJoinClientIdsFromLog()) {
    if (localClientId !== undefined && clientId === localClientId) continue;
    if (!playAreas[clientId]) missing++;
  }

  return missing;
}

export async function waitForMultiplayerGameState(maxWaitMs = 15000): Promise<boolean> {
  const deadline = performance.now() + maxWaitMs;

  while (performance.now() < deadline) {
    await waitForGameLogCatchUp({
      maxWaitMs: Math.max(250, deadline - performance.now()),
    });
    syncPlayAreasFromGameLog();

    const localClientId = getLocalPlayerClientId() ?? provider?.awareness?.clientID;
    const missingBoards = countRemoteJoinsMissingPlayAreas(localClientId);
    const remotePlayers = players().filter(
      player => player.id !== provider?.awareness?.clientID && !player.entry?.isSpectating,
    );
    const awarenessMissingBoards = remotePlayers.some(player => !playAreas[player.id]);

    if (missingBoards === 0 && !awarenessMissingBoards) {
      return true;
    }

    if (
      missingBoards === 0 &&
      remotePlayers.length === 0 &&
      getActiveJoinClientIdsFromLog().size <= 1
    ) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 150));
  }

  syncPlayAreasFromGameLog();
  const localClientId = getLocalPlayerClientId() ?? provider?.awareness?.clientID;
  return countRemoteJoinsMissingPlayAreas(localClientId) === 0;
}

function isRemotePlayerEvent(event: Event) {
  return event.clientID !== getLocalPlayerClientId();
}

const EVENTS = {
  join(event: Event) {
    applyJoinEvent(event);
  },
  concede(event: Event, playArea: PlayArea) {
    onConcede(event.clientID);
  },
  kick(event: Event) {
    const { targetClientId, playerSessionId, gameId } = event.payload ?? {};
    if (targetClientId === undefined) return;
    onKickPlayer(targetClientId, { playerSessionId, gameId });
    readjustPlayAreas();
  },
  passTurn(event: ReturnType<typeof EventCreators.createPassTurnEvent>) {
    if (event.clientID === provider.awareness.clientID) {
      createAnnouncement(`You passed turn`);
    } else {
      let player = players().find(player => player.id === event.clientID);
      if (player) {
        createAnnouncement(`${player.entry.name} passed turn.`);
      }
    }
  },
  toggleTokenMenu(event: Event, playArea: PlayArea) {
    return playArea.toggleTokenMenu(event.payload);
  },
  queueAnimationGroup(event: Event) {
    queueAnimationGroup();
  },
  modifyCard(event: Event, playArea: PlayArea, card: Card) {
    if (!card?.mesh) return;
    const prev = structuredClone(
      card.mesh.userData.modifiers ?? { power: 0, toughness: 0, counters: {} },
    );
    setCardData(card.mesh, 'modifiers', event.payload.userData.modifiers);
    playCounterSoundForModifierChange(
      prev,
      event.payload.userData.modifiers,
      isRemotePlayerEvent(event),
    );
    playArea.modifyCard(card);
  },
  createCounter(event: Event) {
    setCounters(counters => uniqBy([...counters, event.counter], 'id'));
  },
  animateObject(event: Event, playArea: PlayArea) {
    const target = resolveAnimationTarget(event.payload?.userData?.id, playArea);
    if (!target) return;

    if (event.payload?.userData) {
      const [_, cloneable] = splitUserdata(event.payload.userData);
      Object.assign(target.userData, cloneable);
    }

    const opts = rehydrateAnimation(event.payload.animation);
    if (shouldSyncOrientationFromEvents()) {
      opts.duration = 0;
      opts.completeOnCancel = true;
    }
    animateObject(target, opts);
  },
  async transferCard(event: Event, playArea: PlayArea, card: Card) {
    const fromZone = resolveZoneFromEvent(event.payload.fromZoneId, playArea);
    const toZone = resolveZoneFromEvent(event.payload.toZoneId, playArea);

    if (!fromZone && !toZone) return;

    if (!card && fromZone?.zone === 'deck') {
      const deck = fromZone as Deck;
      const cardId = event.payload?.userData?.id;
      if (cardId) {
        card = deck.cards.find(
          entry => entry.id === cardId || String(entry.id) === String(cardId),
        );
        if (card) {
          cardsById.set(card.id, card);
        }
      }
    }

    if (!card) return;

    let resolvedFromZone = fromZone;
    if (!isCardInZone(card, resolvedFromZone)) {
      if (isCardInZone(card, toZone)) return;
      const actualZone = findZoneContainingCard(card, playArea);
      if (actualZone) {
        resolvedFromZone = actualZone;
      } else if (resolvedFromZone?.zone !== 'deck') {
        return;
      }
    }

    const clientId = playArea?.clientId ?? card.clientId;
    if (resolvedFromZone?.zone === 'deck') {
      (resolvedFromZone as Deck).prepareCardForRemoval(card);
    } else if (!card.mesh && clientId !== undefined) {
      ensureCardMesh(card, clientId);
    }

    if (!card.mesh) return;

    if (event.payload?.userData) {
      applyEventUserData(card, event.payload.userData);
    }

    if (
      event.clientID === getLocalPlayerClientId() &&
      event.payload.extendedOptions?.addOptions?.skipLocalAnimation
    ) {
      event.payload.extendedOptions.addOptions.skipAnimation = true;
    }

    const replaying = shouldSyncOrientationFromEvents();
    const transferOptions = {
      ...(event.payload.extendedOptions ?? {}),
      preventTransmit: true,
    };
    if (replaying) {
      transferOptions.addOptions = { ...transferOptions.addOptions, skipAnimation: true };
    }

    await transferCard(card, resolvedFromZone, toZone, transferOptions);
    if (card.mesh && toZone?.zone === 'battlefield' && replaying) {
      applyCardOrientation(card.mesh);
    }
    const remote = isRemotePlayerEvent(event);
    if (toZone?.zone === 'hand') {
      playDrawSound(remote);
    } else if (resolvedFromZone?.zone === 'hand' && toZone?.zone === 'battlefield') {
      playPlayCardSound(remote);
    }
  },
  async restack(event: ReturnType<typeof EventCreators.createRestackEvent>, playArea: PlayArea) {
    const zone = resolveZoneFromEvent(event.payload.zoneId, playArea);
    if (zone && zone.zone !== 'battlefield') return;

    const items = event.payload.items
      .map(item => resolveEventCard(item.id, playArea)?.mesh)
      .filter(Boolean);

    await restackItems(new Vector3().fromArray(event.payload.anchor), items);

    for (const mesh of items) {
      if (!mesh) continue;
      const zoneId = zone?.id ?? mesh.userData.zoneId;
      if (!zoneId) continue;
      setCardData(mesh, `zone.${zoneId}.position`, mesh.position.toArray());
      setCardData(mesh, `zone.${zoneId}.rotation`, mesh.rotation.toArray());
    }
  },
  createCard(event: Event, playArea: PlayArea) {
    let card = cloneCard({ detail: event.payload.userData.card.detail }, event.payload.userData.id);
    if (event.payload.userData.isToken) {
      setCardData(card.mesh, 'isToken', true);
      updateModifiers(card);
    }

    let zone = zonesById.get(event.payload.zoneId);
    let options = {};

    let p = event.payload?.addOptions?.position;
    if (p) {
      options.position = new Vector3(p.x, p.y, p.z);
    }

    zone?.addCard(card, options);
  },
  tap(event: Event, playArea: PlayArea, card: Card) {
    if (!card?.mesh) return;

    const isReplay = shouldSyncOrientationFromEvents();
    playTapSound(isRemotePlayerEvent(event));

    if (isReplay) {
      playArea?.tap(card.mesh, { skipAnimation: true, syncOnly: true });
      return;
    }

    if (isRemotePlayerEvent(event)) {
      playArea?.tap(card.mesh, { syncOnly: true });
    }
  },
  async flip(event: Event, playArea: PlayArea, card: Card) {
    if (!card?.mesh) return;
    playArea?.applyFlipVisual(card.mesh, { animate: isEventCatchUpComplete() });
    if (card.mesh.userData.isDoubleSided) {
      await loadCardTextures(card);
      if (!isEventCatchUpComplete() || isHistoricalLogReplayInProgress()) {
        playArea?.applyFlipVisual(card.mesh, { animate: false });
      }
    }
  },
  clone(event: Event, playArea: PlayArea) {
    playArea?.clone(event.payload.id, event.payload.newId);
  },
  deleteClone(event: Event, playArea: PlayArea) {
    playArea?.executeDeleteClone(event.payload.id);
  },
  reveal(event: Event, remotePlayArea: PlayArea, card: Card) {
    expect(!!card, 'card not found');
    let cardProxy = cloneCard(card, nanoid());
    const playArea = getLocalPlayArea();
    setCardData(cardProxy.mesh, 'zoneId', undefined);
    setCardData(cardProxy.mesh, 'isLocalOnly', true);

    playArea.reveal(cardProxy);
  },
  deckFlipTop(event: Event, playArea: PlayArea) {
    playArea?.deckFlipTop(event.payload.toggle);
  },
  shuffleDeck(event: Event, playArea: PlayArea) {
    playShuffleDeckSound(isRemotePlayerEvent(event));
    return playArea?.executeShuffleDeck(event.payload.order);
  },
  mulligan(event: Event, playArea: PlayArea) {
    return playArea.executeMulligan(event.payload.drawCount, event.payload.order, {
      remote: isRemotePlayerEvent(event),
    });
  },
  dismissZone(event: Event, playArea: PlayArea) {
    const zone = resolveZoneFromEvent(event.payload.zoneId, playArea);
    if (!zone || !playArea) return;
    return playArea.executeDismissZone(zone);
  },
  peekCards(event: Event, playArea: PlayArea) {
    const fromZone = resolveZoneFromEvent(event.payload.fromZoneId, playArea);
    const toZone = resolveZoneFromEvent(event.payload.toZoneId, playArea);
    if (!fromZone || !toZone || !playArea) return;
    return playArea.executePeekCards(fromZone, toZone, event.payload.count, {
      skipAnimation: event.payload.skipAnimation ?? event.payload.count > 5,
    });
  },
  transferEntireZone(event: Event, playArea: PlayArea) {
    const fromZone = resolveZoneFromEvent(event.payload.fromZoneId, playArea);
    const toZone = resolveZoneFromEvent(event.payload.toZoneId, playArea);
    if (!fromZone || !toZone || !playArea) return;
    return playArea.executeTransferEntireZone(fromZone, toZone, event.payload.addOptions);
  },
};

function addLogMessage(event) {
  if (isEphemeralEvent(event)) return;
  let index = logs.length;

  const { type, clientID, payload } = event;
  let count = 1;
  let lastEvent = logs[index - 1];
  if (isLogMessageStackable(lastEvent, event)) {
    count = lastEvent.count + 1;
    index--;
  }

  let logPayload = payload;
  if (type !== 'join') {
    if (payload?.userData) {
      logPayload = {
        ...logPayload,
        userData: { ...logPayload.userData, cardBack: undefined },
      };
    }
  }

  const logClientId = type === 'kick' ? payload?.targetClientId : clientID;

  setLogs(index, {
    type,
    clientID: logClientId,
    payload: logPayload,
    count,
  });
}
