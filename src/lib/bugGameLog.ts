import { strToU8, zipSync } from 'fflate';
import { subscribeClientErrors } from './clientErrorReporting';
import {
  gameLog,
  gameState,
  getLocalPlayerClientId,
  playAreas,
  processedEvents,
  provider,
} from './globals';
import { getPlayAreaPlayerName } from './playAreaNameTag';
import { getOrCreatePlayerSessionId } from './playerSession';

const MAX_LINES = 8_000;
const MAX_LINE_CHARS = 2_000;
const SYNC_DEBOUNCE_MS = 4_000;

export interface SharedBugGameLogEntry {
  playerSessionId: string;
  displayName: string;
  clientId?: number;
  updatedAt: number;
  text: string;
}

type BugGameLogStore = Record<string, SharedBugGameLogEntry>;

let activeGameId: string | undefined;
let activeSessionId: string | undefined;
const lines: string[] = [];
let unsubscribeErrors: (() => void) | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

function formatTimestamp() {
  return new Date().toISOString();
}

function sanitizeLine(value: string) {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_LINE_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_LINE_CHARS)}…`;
}

function playerDisplayName() {
  const name = provider?.awareness?.getLocalState()?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return 'Player';
}

function trimLines() {
  if (lines.length <= MAX_LINES) return;
  lines.splice(0, lines.length - MAX_LINES);
}

export function appendBugGameLog(category: string, message: string, details?: Record<string, unknown>) {
  if (!activeGameId) return;
  const detailText =
    details && Object.keys(details).length
      ? ` ${JSON.stringify(details, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}`
      : '';
  lines.push(`${formatTimestamp()} [${category}] ${sanitizeLine(message)}${detailText}`);
  trimLines();
  scheduleBugLogSync();
}

export function getBattlefieldVisibilitySnapshot() {
  const seats = Object.values(playAreas)
    .filter((area): area is NonNullable<typeof area> => !!area)
    .map(area => ({
      clientId: area.clientId,
      name: getPlayAreaPlayerName(area),
      battlefieldCards: area.battlefieldZone.cards.length,
    }))
    .sort((left, right) => left.clientId - right.clientId);

  const totalBattlefieldCards = seats.reduce((sum, seat) => sum + seat.battlefieldCards, 0);

  return {
    totalBattlefieldCards,
    seats,
    gameLogLength: gameLog?.length ?? 0,
    processedEvents: processedEvents(),
  };
}

export function logBugGameBattlefieldCheck(context: string, extra?: Record<string, unknown>) {
  appendBugGameLog('battlefield-visibility', context, {
    ...getBattlefieldVisibilitySnapshot(),
    ...extra,
  });
}

export function logBugGameCardToBattlefield(options: {
  cardId: string;
  cardName: string;
  fromZone?: string;
  ownerClientId?: number;
  replay: boolean;
  locallyInitiated: boolean;
}) {
  logBugGameBattlefieldCheck('card moved to battlefield', {
    cardId: options.cardId,
    cardName: options.cardName,
    fromZone: options.fromZone,
    ownerClientId: options.ownerClientId,
    replay: options.replay,
    locallyInitiated: options.locallyInitiated,
  });
}

function buildHeader(gameId: string) {
  return [
    'ArcaneTable bug game log',
    `gameId: ${gameId}`,
    `playerSessionId: ${activeSessionId ?? 'unknown'}`,
    `displayName: ${playerDisplayName()}`,
    `clientId: ${getLocalPlayerClientId() ?? provider?.awareness?.clientID ?? 'unknown'}`,
    `userAgent: ${navigator.userAgent}`,
    '---',
  ].join('\n');
}

export function getLocalBugGameLogText() {
  if (!activeGameId) return '';
  return `${buildHeader(activeGameId)}\n${lines.join('\n')}\n`;
}

function sanitizeFilenamePart(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'player'
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readSharedBugLogs(): BugGameLogStore {
  const raw = gameState?.get?.('bugGameLogs');
  if (!raw || typeof raw !== 'object') return {};
  return raw as BugGameLogStore;
}

function publishLocalBugLogNow() {
  if (!gameState || !activeSessionId) return;

  const entry: SharedBugGameLogEntry = {
    playerSessionId: activeSessionId,
    displayName: playerDisplayName(),
    clientId: getLocalPlayerClientId() ?? provider?.awareness?.clientID,
    updatedAt: Date.now(),
    text: getLocalBugGameLogText(),
  };

  gameState.doc?.transact(() => {
    const current = readSharedBugLogs();
    gameState.set('bugGameLogs', {
      ...current,
      [activeSessionId]: entry,
    });
  });
}

function scheduleBugLogSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    publishLocalBugLogNow();
  }, SYNC_DEBOUNCE_MS);
}

export function exportBugGameLogsZip(gameId: string) {
  publishLocalBugLogNow();

  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();

  const addFile = (basename: string, text: string) => {
    let filename = basename.endsWith('.txt') ? basename : `${basename}.txt`;
    while (usedNames.has(filename)) {
      filename = filename.replace(/\.txt$/, `-dup.txt`);
    }
    usedNames.add(filename);
    files[filename] = strToU8(text);
  };

  const shared = readSharedBugLogs();
  const sharedEntries = Object.values(shared).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );

  if (sharedEntries.length) {
    for (const entry of sharedEntries) {
      const name = sanitizeFilenamePart(entry.displayName);
      const idSuffix = entry.playerSessionId.slice(0, 8);
      addFile(`bug-log-${name}-${idSuffix}`, entry.text || '(empty log)');
    }
  } else if (activeGameId === gameId) {
    addFile(`bug-log-${sanitizeFilenamePart(playerDisplayName())}-local`, getLocalBugGameLogText());
  }

  if (!Object.keys(files).length) {
    throw new Error('No bug logs available for this game yet.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zipped = zipSync(files);
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), `arcanetable-bug-log-${gameId}-${stamp}.zip`);
}

export function initBugGameLog(gameId: string) {
  teardownBugGameLog();

  activeGameId = gameId;
  activeSessionId = getOrCreatePlayerSessionId(gameId);
  lines.length = 0;

  appendBugGameLog('session', 'Bug game log started', {
    gameId,
    playerSessionId: activeSessionId,
  });

  unsubscribeErrors = subscribeClientErrors(error => {
    appendBugGameLog('error', error.message, {
      name: error.name,
      stack: error.stack?.split('\n').slice(0, 8).join(' | '),
    });
  });

  publishLocalBugLogNow();
}

export function teardownBugGameLog() {
  if (activeGameId && activeSessionId) {
    publishLocalBugLogNow();
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  unsubscribeErrors?.();
  unsubscribeErrors = undefined;
  activeGameId = undefined;
  activeSessionId = undefined;
  lines.length = 0;
}

export function isBugGameLogActive() {
  return !!activeGameId;
}
