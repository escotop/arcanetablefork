import { Card, DetailedCardEntry } from './constants';
import { getDeckStore } from './deckStore';
import { getCardKey } from './deckEntryMatch';
import { formatDeckExportContent } from './deckListFormat';
import { loadGameMeta } from './gameMeta';
import { getLocalPlayerClientId, playAreas } from './globals';
import type { PlayArea } from './playArea';

function isPlayableDeckCard(card: Card) {
  if (card.mesh?.userData?.isToken) return false;
  if (card.mesh?.userData?.isClone) return false;
  return Boolean(card.detail?.name);
}

function cardToDeckEntry(card: Card): DetailedCardEntry {
  const detail = card.detail;
  const name = detail.name;
  const set = detail.set ?? '';
  const collector_number = detail.collector_number;
  const entry: DetailedCardEntry = {
    id: getCardKey({ id: '', name, qty: 1, categories: [], set, collector_number }),
    name,
    qty: 1,
    categories: [],
    set,
    collector_number,
    detail,
    customArtUrl: card.customArtUrl,
  };
  return entry;
}

function collectPlayAreaDeckCards(playArea: PlayArea): Card[] {
  return [
    ...playArea.deck.cards,
    ...playArea.hand.cards,
    ...playArea.battlefieldZone.cards,
    ...playArea.graveyardZone.cards,
    ...playArea.exileZone.cards,
    ...playArea.peekZone.cards,
    ...playArea.revealZone.cards,
  ];
}

export function buildPlayAreaDeckExportContent(playArea: PlayArea): string {
  const cards: Record<string, DetailedCardEntry> = {};

  for (const card of collectPlayAreaDeckCards(playArea)) {
    if (!isPlayableDeckCard(card)) continue;

    const entry = cardToDeckEntry(card);
    const key = getCardKey(entry);
    const existing = cards[key];
    if (existing) {
      existing.qty += 1;
      continue;
    }

    cards[key] = entry;
  }

  return formatDeckExportContent({ cards });
}

export function getPlayerDeckExportContent(clientId: number, gameId: string): string | undefined {
  const playArea = playAreas[clientId];
  if (!playArea) return undefined;

  const isLocal = playArea.isLocalPlayArea || clientId === getLocalPlayerClientId();
  if (isLocal) {
    const deckId = loadGameMeta(gameId)?.deckId;
    const deck = deckId ? getDeckStore().decks[deckId] : undefined;
    if (deck) {
      return formatDeckExportContent(deck);
    }
  }

  const content = buildPlayAreaDeckExportContent(playArea);
  return content.trim() ? content : undefined;
}

export async function copyPlayerDeckToClipboard(clientId: number, gameId: string): Promise<boolean> {
  const content = getPlayerDeckExportContent(clientId, gameId);
  if (!content?.trim()) return false;

  await navigator.clipboard.writeText(content);
  return true;
}
