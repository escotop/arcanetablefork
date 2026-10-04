import { Deck, DetailedCardEntry } from './constants';
import { getDeckCoverMetadata } from './deck';

export function slimCardForPersistence(card: DetailedCardEntry): DetailedCardEntry {
  const {
    detail: _detail,
    importLookupTrace: _trace,
    importLookupReason: _reason,
    found: _found,
    printingMismatch: _mismatch,
    ...rest
  } = card;
  return rest as DetailedCardEntry;
}

export function serializeDeck(deck: Deck) {
  const serializedDeck = { ...deck, cards: {}, inPlay: {}, sideboard: {}, tokens: {} };

  for (const [name, card] of Object.entries(deck.cards)) {
    if (card.qty < 1) continue;
    serializedDeck.cards[name] = slimCardForPersistence(card);
  }

  for (const [name, card] of Object.entries(deck.inPlay ?? {})) {
    if (card.qty < 1) continue;
    serializedDeck.inPlay[name] = slimCardForPersistence(card);
  }

  for (const [name, card] of Object.entries(deck.sideboard ?? {})) {
    if (card.qty < 1) continue;
    serializedDeck.sideboard[name] = slimCardForPersistence(card);
  }

  for (const [name, card] of Object.entries(deck.tokens ?? {})) {
    if (card.qty < 1) continue;
    serializedDeck.tokens[name] = slimCardForPersistence(card);
  }

  if ((serializedDeck.version ?? 0) >= 2) {
    serializedDeck.cardList = undefined;
  }

  Object.assign(serializedDeck, getDeckCoverMetadata(deck));
  return serializedDeck;
}

export function serializeDeckForPersistence(deck: Deck): Deck {
  return serializeDeck(deck);
}

export interface PersistedDeckStore {
  decks: Record<string, Deck>;
  systems: Record<string, string[]>;
}

export function serializeDeckStoreForPersistence(store: PersistedDeckStore): PersistedDeckStore {
  return {
    systems: store.systems ?? {},
    decks: Object.fromEntries(
      Object.entries(store.decks ?? {}).map(([id, deck]) => [
        id,
        serializeDeckForPersistence({ ...deck, id: deck.id ?? id }),
      ]),
    ),
  };
}

export function deckStoreHasEmbeddedDetails(store: PersistedDeckStore): boolean {
  for (const deck of Object.values(store.decks ?? {})) {
    if (deck.cardList) return true;
    for (const section of [deck.cards, deck.inPlay, deck.sideboard, deck.tokens]) {
      if (!section) continue;
      for (const card of Object.values(section)) {
        if (card.detail && Object.keys(card.detail).length > 0) return true;
      }
    }
  }
  return false;
}
