/**
 * Safety net for desyncs between players.
 *
 * Every player publishes (in awareness) a short digest of their own seat: hand/deck counts,
 * battlefield cards with tapped/flipped, graveyard and exile. Each client computes the same
 * digest for the seats it renders. When a remote seat stays different from its owner's digest
 * for a few seconds while this client has applied the whole log, it asks the owner (also via
 * awareness) to re-publish the seat. The owner pushes a `seatSync` event with its serialized
 * seat into the gameLog, and every observer rebuilds that seat from it (remoteEvents.ts).
 *
 * Going through the log keeps the snapshot ordered after the owner's earlier events and makes
 * reloads replay the repair too.
 */
import { nanoid } from 'nanoid';
import type { Card } from './constants';
import {
  flushDispatchEventQueue,
  getLocalPlayArea,
  getLocalPlayerClientId,
  isEventCatchUpComplete,
  isGameLogFullyApplied,
  isGameplayBlocked,
  isGameStateImportInProgress,
  isHistoricalLogReplayInProgress,
  isSpectating,
  isSyncPaused,
  playAreas,
  provider,
  sendEvent,
  tearingDown,
} from './globals';
import { slimPlayAreaStateForSnapshot } from './gameLogEvents';
import { appendBugGameLog } from './bugGameLog';
import type { PlayArea } from './playArea';

export const SEAT_SYNC_VERSION = 1;

const CHECK_INTERVAL_MS = 1_000;
/** Both digests must have been stable this long before a mismatch counts (events in flight). */
const STABLE_MS = 2_500;
const REQUEST_COOLDOWN_MS = 10_000;
const RESPOND_COOLDOWN_MS = 4_000;
const MAX_ATTEMPTS = 3;
const ATTEMPT_WINDOW_MS = 2 * 60_000;
const GIVE_UP_MS = 5 * 60_000;

type SeatDigestInfo = { v: number; seat: number; digest: string };

type SeatTrack = {
  ownerDigest?: string;
  ownerSince: number;
  localDigest?: string;
  localSince: number;
  lastRequestAt: number;
  attempts: number;
  windowStart: number;
  givenUpUntil: number;
};

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function sortedIds(cards: Card[]) {
  return cards.map(card => String(card.id)).sort();
}

/** Same result on the owner and on every observer when they show the same seat. */
export function computeSeatDigest(area: PlayArea): string {
  const battlefield = area.battlefieldZone.cards
    .map(card => {
      const userData = card.mesh?.userData ?? {};
      return `${card.id}:${userData.isTapped ? 1 : 0}${userData.isFlipped ? 1 : 0}`;
    })
    .sort();
  return fnv1a(
    JSON.stringify([
      area.hand.cards.length,
      area.deck.cards.length,
      battlefield,
      sortedIds(area.graveyardZone.cards),
      sortedIds(area.exileZone.cards),
    ]),
  );
}

function isReady() {
  return (
    !tearingDown &&
    isEventCatchUpComplete() &&
    !isHistoricalLogReplayInProgress() &&
    !isSyncPaused() &&
    !isGameplayBlocked() &&
    !isGameStateImportInProgress()
  );
}

const tracks = new Map<number, SeatTrack>();
const handledRequests = new Set<string>();
let lastResponseAt = 0;
let interval: ReturnType<typeof setInterval> | undefined;
let detachAwareness: (() => void) | undefined;

function getTrack(seat: number): SeatTrack {
  let track = tracks.get(seat);
  if (!track) {
    track = {
      ownerSince: 0,
      localSince: 0,
      lastRequestAt: 0,
      attempts: 0,
      windowStart: 0,
      givenUpUntil: 0,
    };
    tracks.set(seat, track);
  }
  return track;
}

function awareness() {
  return provider?.awareness;
}

function publishOwnDigest() {
  const area = getLocalPlayArea();
  if (!area?.isLocalPlayArea || isSpectating()) return;
  // Other players can move our cards too; only publish once their events are applied.
  if (!isReady() || !isGameLogFullyApplied()) return;

  const digest = computeSeatDigest(area);
  const current = awareness()?.getLocalState()?.seatSync as SeatDigestInfo | undefined;
  if (current?.digest === digest && current.seat === area.clientId) return;
  awareness()?.setLocalStateField('seatSync', {
    v: SEAT_SYNC_VERSION,
    seat: area.clientId,
    digest,
  } satisfies SeatDigestInfo);
}

function requestResync(seat: number, ownerDigest: string, localDigest: string) {
  const local = awareness()?.getLocalState() ?? {};
  const requests = { ...((local.seatSyncRequests as Record<string, string>) ?? {}) };
  requests[String(seat)] = nanoid(8);
  awareness()?.setLocalStateField('seatSyncRequests', requests);
  appendBugGameLog('sync-heal', 'seat differs from its owner, requesting resync', {
    seat,
    ownerDigest,
    localDigest,
  });
}

function checkRemoteSeats() {
  const states = awareness()?.getStates();
  if (!states) return;

  const now = Date.now();
  const localSeat = getLocalPlayerClientId();
  const canCompare = isReady() && isGameLogFullyApplied();
  const seen = new Set<number>();

  for (const state of states.values()) {
    const info = (state as Record<string, unknown> | undefined)?.seatSync as
      | SeatDigestInfo
      | undefined;
    if (!info || typeof info.seat !== 'number' || typeof info.digest !== 'string') continue;
    if (info.seat === localSeat) continue;
    const area = playAreas[info.seat];
    if (!area || area.isLocalPlayArea) continue;
    seen.add(info.seat);

    const track = getTrack(info.seat);
    if (track.ownerDigest !== info.digest) {
      track.ownerDigest = info.digest;
      track.ownerSince = now;
    }
    if (!canCompare) continue;

    const localDigest = computeSeatDigest(area);
    if (track.localDigest !== localDigest) {
      track.localDigest = localDigest;
      track.localSince = now;
    }

    if (localDigest === info.digest) {
      track.attempts = 0;
      continue;
    }
    if (now - track.ownerSince < STABLE_MS || now - track.localSince < STABLE_MS) continue;
    if (now < track.givenUpUntil || now - track.lastRequestAt < REQUEST_COOLDOWN_MS) continue;

    if (now - track.windowStart > ATTEMPT_WINDOW_MS) {
      track.windowStart = now;
      track.attempts = 0;
    }
    if (track.attempts >= MAX_ATTEMPTS) {
      track.givenUpUntil = now + GIVE_UP_MS;
      appendBugGameLog('sync-heal', 'seat still differs after resyncs, pausing requests', {
        seat: info.seat,
        ownerDigest: info.digest,
        localDigest,
      });
      continue;
    }

    track.attempts++;
    track.lastRequestAt = now;
    requestResync(info.seat, info.digest, localDigest);
  }

  for (const seat of tracks.keys()) {
    if (!seen.has(seat)) tracks.delete(seat);
  }
}

/** Old clients throw on unknown event types, so only publish when everyone understands seatSync. */
function allPeersSupportSeatSync() {
  const aw = awareness();
  if (!aw) return false;
  for (const [id, state] of aw.getStates()) {
    if (id === aw.clientID) continue;
    const support = (state as Record<string, unknown> | undefined)?.seatSyncSupport;
    if (typeof support !== 'number' || support < SEAT_SYNC_VERSION) return false;
  }
  return true;
}

function respondToRequests() {
  const aw = awareness();
  const area = getLocalPlayArea();
  if (!aw || !area?.isLocalPlayArea || isSpectating()) return;
  if (!isReady() || !isGameLogFullyApplied()) return;

  const seatKey = String(area.clientId);
  const pending: string[] = [];
  for (const [id, state] of aw.getStates()) {
    if (id === aw.clientID) continue;
    const requests = (state as Record<string, unknown> | undefined)?.seatSyncRequests as
      | Record<string, string>
      | undefined;
    const requestId = requests?.[seatKey];
    if (typeof requestId !== 'string') continue;
    const key = `${id}:${requestId}`;
    if (!handledRequests.has(key)) pending.push(key);
  }
  if (!pending.length) return;
  // Coalesce requests from several observers; the interval retries after the cooldown.
  if (Date.now() - lastResponseAt < RESPOND_COOLDOWN_MS) return;

  pending.forEach(key => handledRequests.add(key));
  if (!allPeersSupportSeatSync()) {
    appendBugGameLog('sync-heal', 'resync requested but a peer runs an older version', {
      seat: area.clientId,
    });
    return;
  }
  lastResponseAt = Date.now();
  void publishSeatState(area, pending);
}

async function publishSeatState(area: PlayArea, requestKeys: string[]) {
  await flushDispatchEventQueue();
  const state = JSON.parse(
    JSON.stringify(slimPlayAreaStateForSnapshot(area.getLocalState() as Record<string, unknown>)),
  );
  const digest = computeSeatDigest(area);
  sendEvent({
    type: 'seatSync',
    payload: { seat: area.clientId, requestId: requestKeys.join(','), digest, state },
  });
  appendBugGameLog('sync-heal', 'published own seat state on request', {
    seat: area.clientId,
    digest,
    requests: requestKeys.length,
  });
}

function tick() {
  if (tearingDown || !awareness()) return;
  try {
    publishOwnDigest();
    checkRemoteSeats();
    respondToRequests();
  } catch (error) {
    appendBugGameLog('sync-heal', 'seat sync check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function teardownSeatSync() {
  if (interval) clearInterval(interval);
  interval = undefined;
  detachAwareness?.();
  detachAwareness = undefined;
  tracks.clear();
  handledRequests.clear();
  lastResponseAt = 0;
}

/** Start publishing/checking seat digests for the current provider. Safe to call again. */
export function setupSeatSync() {
  teardownSeatSync();
  const aw = awareness();
  if (!aw) return teardownSeatSync;

  aw.setLocalStateField('seatSyncSupport', SEAT_SYNC_VERSION);
  const onChange = () => respondToRequests();
  aw.on('change', onChange);
  detachAwareness = () => aw.off('change', onChange);
  interval = setInterval(tick, CHECK_INTERVAL_MS);
  return teardownSeatSync;
}
