import { Card } from '~/lib/constants';
import { doXTimes } from '~/lib/globals';
import { PlayArea } from '~/lib/playArea';
import { transferCard } from '~/lib/transferCard';

export function drawCards(playArea: PlayArea, count: number = 1) {
  doXTimes(count, () => playArea.draw());
}

export function peekFromTop(playArea: PlayArea, count = 1) {
  void playArea.peekCards(count);
}

export function searchDeck(playArea: PlayArea) {
  peekFromTop(playArea, playArea.deck.cards.length);
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
