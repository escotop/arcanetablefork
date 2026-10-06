import {
  estimateCommanderBracket,
  getBracketEstimateFromResult,
  getDeckEntriesForBracketEstimate,
} from './commanderBracket';
import { canBeCommander, toggleCommanderCategories } from './deckCommander';
import { buildDetailedDeckEntriesFromPlayArea } from './deckExport';
import { getDeckStore } from './deckStore';
import { Deck, DetailedCardEntry } from './constants';
import { loadGameMeta } from './gameMeta';
import { getLocalPlayerClientId, playAreas } from './globals';

const estimateCache = new Map<string, number | undefined>();

function cacheKey(gameId: string, clientId: number) {
  return `${gameId}:${clientId}`;
}

export function getStoredDeckForGamePlayer(clientId: number, gameId: string): Deck | undefined {
  const playArea = playAreas[clientId];
  if (!playArea) return undefined;

  const isLocal = playArea.isLocalPlayArea || clientId === getLocalPlayerClientId();
  if (!isLocal) return undefined;

  const deckId = loadGameMeta(gameId)?.deckId;
  if (!deckId) return undefined;
  return getDeckStore().decks[deckId];
}

function inferCommandersFromBattlefield(
  entries: DetailedCardEntry[],
  playArea: NonNullable<(typeof playAreas)[number]>,
) {
  const battlefieldNames = new Set(
    playArea.battlefieldZone.cards.map(card => card.detail?.name).filter(Boolean) as string[],
  );

  for (const entry of entries) {
    if (!battlefieldNames.has(entry.name)) continue;
    if (!canBeCommander(entry)) continue;
    entry.categories = toggleCommanderCategories(entry.categories, true);
  }
}

function bracketCardsForPlayArea(clientId: number): DetailedCardEntry[] | undefined {
  const playArea = playAreas[clientId];
  if (!playArea) return undefined;

  const entries = buildDetailedDeckEntriesFromPlayArea(playArea);
  inferCommandersFromBattlefield(entries, playArea);
  return entries;
}

export async function resolveInGamePlayerBracket(
  clientId: number,
  gameId: string,
): Promise<number | undefined> {
  const key = cacheKey(gameId, clientId);
  if (estimateCache.has(key)) {
    return estimateCache.get(key);
  }

  const stored = getStoredDeckForGamePlayer(clientId, gameId);
  if (stored?.bracketEstimate != null) {
    estimateCache.set(key, stored.bracketEstimate);
    return stored.bracketEstimate;
  }

  const cards = stored ? getDeckEntriesForBracketEstimate(stored) : bracketCardsForPlayArea(clientId);
  if (!cards?.length) {
    estimateCache.set(key, undefined);
    return undefined;
  }

  try {
    const result = await estimateCommanderBracket(cards);
    const bracket = getBracketEstimateFromResult(result);
    estimateCache.set(key, bracket);
    return bracket;
  } catch {
    estimateCache.set(key, undefined);
    return undefined;
  }
}

export function clearInGamePlayerBracketCache(gameId?: string) {
  if (!gameId) {
    estimateCache.clear();
    return;
  }
  for (const key of estimateCache.keys()) {
    if (key.startsWith(`${gameId}:`)) estimateCache.delete(key);
  }
}
