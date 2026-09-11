import { Card } from '~/lib/constants';
import {
  createDeckDrawLogEvent,
  createDeckPeekLogEvent,
  createDeckPeekMoveEvent,
  createDeckPeekReorderEvent,
  createDeckSearchLogEvent,
  createTransferCardEvent,
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

export function logDeckDrawChoice(cardName: string, deckPosition: number) {
  dispatchGameEvent(
    createDeckDrawLogEvent({ source: 'choice', cardName, deckPosition }),
  );
}

export function logDeckPeekReorder(order: string[]) {
  dispatchGameEvent(createDeckPeekReorderEvent(order));
}

export function logDeckPeekMove(placement: 'top' | 'bottom', cardId: string) {
  dispatchGameEvent(createDeckPeekMoveEvent(placement, cardId));
}

export function drawCards(playArea: PlayArea, count: number = 1) {
  const cards = playArea.deck.cards.slice(0, Math.max(0, count));
  for (const card of cards) {
    if (playArea.deck.cards[0]?.id === card.id) {
      playArea.deck.materializeTopCard();
    } else {
      playArea.deck.prepareCardForRemoval(card);
    }
    logDeckDrawTop();
    dispatchGameEvent(createTransferCardEvent(card, playArea.deck, playArea.hand));
  }
  return flushDispatchEventQueue();
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
