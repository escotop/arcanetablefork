import { Card } from '~/lib/constants';
import {
  createDeckDrawLogEvent,
  createDeckPeekLogEvent,
  createDeckPeekMoveEvent,
  createDeckPeekReorderEvent,
  createDeckSearchLogEvent,
} from '~/lib/createEvents';
import { dispatchGameEvent, doXTimes, flushDispatchEventQueue } from '~/lib/globals';
import { PlayArea } from '~/lib/playArea';
import { transferCard } from '~/lib/transferCard';

export const OPENING_HAND_SIZE = 7;

export function logDeckPeek(count: number) {
  dispatchGameEvent(createDeckPeekLogEvent(count));
}

export function logDeckSearch() {
  dispatchGameEvent(createDeckSearchLogEvent());
}

export function logDeckDrawTop() {
  dispatchGameEvent(createDeckDrawLogEvent({ source: 'top' }));
}

export function logDeckDrawFromPeek() {
  dispatchGameEvent(createDeckDrawLogEvent({ source: 'peek' }));
}

export function logDeckDrawChoice() {
  dispatchGameEvent(createDeckDrawLogEvent({ source: 'choice' }));
}

export function logDeckPeekReorder(order: string[]) {
  dispatchGameEvent(createDeckPeekReorderEvent(order));
}

export function logDeckPeekMove(placement: 'top' | 'bottom', cardId: string) {
  dispatchGameEvent(createDeckPeekMoveEvent(placement, cardId));
}

export async function drawCards(playArea: PlayArea, count: number = 1) {
  const draws = Math.min(Math.max(0, count), playArea.deck.cards.length);
  for (let i = 0; i < draws; i++) {
    const card = playArea.deck.cards[0];
    if (!card) break;
    playArea.deck.materializeTopCard();
    logDeckDrawTop();
    await transferCard(card, playArea.deck, playArea.hand);
  }
  await flushDispatchEventQueue();
}

export function peekFromTop(playArea: PlayArea, count = 1) {
  const actualCount = Math.min(count, playArea.deck.cards.length);
  if (actualCount < 1) return;
  logDeckPeek(actualCount);
  void playArea.peekCards(count, { mode: 'peek' });
}

export function searchDeck(playArea: PlayArea) {
  if (!playArea.deck.cards.length) return;
  logDeckSearch();
  void playArea.peekCards(playArea.deck.cards.length, { mode: 'search' });
}

export function shuffleDeck(playArea: PlayArea) {
  playArea.shuffleDeck();
}

export function discardFromTop(playArea: PlayArea, count = 1) {
  doXTimes(
    count,
    () => transferCard(playArea.deck.cards[0], playArea.deck, playArea.graveyardZone),
    5,
  );
}

export function exileFromTop(playArea: PlayArea, count = 1) {
  doXTimes(count, () => transferCard(playArea.deck.cards[0], playArea.deck, playArea.exileZone), 5);
}

export function getNextLandIndex(cards: Card[]) {
  const count = cards.findIndex(card => card.detail.type_line.toLowerCase().includes('land'));
  return count;
}

export function revealFromTop(playArea: PlayArea, count = 1) {
  doXTimes(
    count,
    () => {
      playArea.reveal(playArea.deck.cards[0]);
      transferCard(playArea.deck.cards[0], playArea.deck, playArea.peekZone);
    },
    5,
  );
}
