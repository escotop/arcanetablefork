import { createStore, SetStoreFunction, unwrap } from 'solid-js/store';
import { nanoid } from 'nanoid';
import { createContext, onMount, ParentProps, useContext } from 'solid-js';
import { CardEntry, Deck, DetailedCardEntry, CardSystem } from './constants';
import { loadCardList, fetchCardInfo } from './deck';
import { applyCustomArtToEntry } from './customCardArt';
import { hasRequestedPrinting, printingMatchesRequest } from './deckPrinting';
import { getCardArtImage } from './card';
import { DEFAULT_CARD_SYSTEM_URI, setCardSystem as setGlobalCardSystem } from './globals';
import { useSearchParams } from '@solidjs/router';
import { CardSystemContext } from './cardSystemContext';

const defaultDeckStore = {
  decks: {},
  systems: {},
};

export const createDeckStore = () => {
  const [store, setStore] = createStore<DeckStore>(defaultDeckStore);

  let deckStore = getDeckStore();
  setStore(deckStore);

  const updateStore: typeof setStore = (...update: any[]) => {
    (setStore as any)(...update);
    let raw = unwrap(store);
    localStorage.setItem('decks', JSON.stringify(raw));
  };

  return [store, updateStore] as const;
};

interface DeckStore {
  decks: Record<string, Deck>;
  systems: Record<string, CardSystem[]>;
}

export function getDeckStore(): DeckStore {
  let storeString = localStorage.getItem('decks');
  if (!storeString) return defaultDeckStore;
  let store = JSON.parse(storeString) as DeckStore;

  if (Array.isArray(store.decks)) {
    let deckEntries = store.decks.map<[string, Deck]>(deck => {
      const id = deck.id ?? nanoid();
      return [deck.id ?? nanoid(), { ...deck, id }];
    });
    store.decks = Object.fromEntries(deckEntries);
    store.systems ??= { unsorted: [] };
    store.systems.unsorted.push(...deckEntries.map(entry => entry[0]));
    localStorage.setItem('decks', JSON.stringify(store));
  }

  Object.entries(store.decks ?? {}).forEach(([id, deck]) => {
    if (!deck.id) {
      store.decks[id] = { ...deck, id };
    }
  });

  return store;
}

const DEFAULT_DECK = {
  cards: {},
  inPlay: {},
};

export function getCardKey(entry: CardEntry) {
  return entry?.id ?? [entry.name, entry.set].join(':');
}

function needsCardHydration(card: DetailedCardEntry) {
  if (!card.detail?.name) return true;
  if (card.id && card.detail.id && card.id !== card.detail.id) return true;
  if (hasRequestedPrinting(card) && !printingMatchesRequest(card.detail, card)) return true;
  return false;
}

async function hydrateCardEntry(card: DetailedCardEntry, cache: Map<string, DetailedCardEntry>) {
  const hydrated = needsCardHydration(card)
    ? await fetchCardInfo(card, cache).catch(() => card)
    : card;
  return applyCustomArtToEntry(hydrated);
}

function syncInPlayEntries(
  inPlayCards: DetailedCardEntry[],
  deckCards: Record<string, DetailedCardEntry>,
) {
  return inPlayCards.map(card => {
    const deckCard =
      deckCards[getCardKey(card)] ??
      Object.values(deckCards).find(
        candidate =>
          candidate.name === card.name &&
          (!card.id || candidate.id === card.id) &&
          (!card.set || !candidate.set || candidate.set === card.set),
      );

    return deckCard ? { ...deckCard, qty: card.qty ?? deckCard.qty } : card;
  });
}

export async function hydrateDeck(originalDeck: Deck) {
  let cache = new Map();

  let deck = structuredClone(originalDeck);

  // migrate to deck v2
  if (deck.cardList) {
    let cardList = loadCardList(deck.cardList);
    deck.cardList = undefined;
    deck.deck = undefined;

    const cards = await Promise.all(
      cardList.map(card => fetchCardInfo(card, cache).then(card => [getCardKey(card), card])),
    );

    deck.cards = Object.fromEntries(cards);

    if (deck.inPlay && Array.isArray(deck.inPlay)) {
      const cards = await Promise.all(
        deck.inPlay.map(card => fetchCardInfo(card, cache).then(card => [getCardKey(card), card])),
      );
      deck.inPlay = Object.fromEntries(cards);
    }
    deck.version = 2;
  }

  let deckCards = Object.values(deck.cards);
  let inPlayCards = Object.values(deck.inPlay ?? {});
  deck.cards = {};
  deck.inPlay = {};

  await Promise.all(
    deckCards.map(async card => {
      const updatedCard = await hydrateCardEntry(card, cache);
      deck.cards[getCardKey(updatedCard)] = updatedCard;
    }),
  );

  const syncedInPlay = syncInPlayEntries(inPlayCards, deck.cards);
  await Promise.all(
    syncedInPlay.map(async card => {
      const updatedCard = await hydrateCardEntry(card, cache);
      deck.inPlay[getCardKey(updatedCard)] = updatedCard;
    }),
  );

  deck = Object.assign({}, structuredClone(DEFAULT_DECK), deck);

  return deck;
}

export function serializeDeck(deck: Deck) {
  const serializedDeck = { ...deck, cards: {}, inPlay: {} };

  let mostPopularCard: DetailedCardEntry;

  for (const [name, card] of Object.entries(deck.cards)) {
    if (card.qty < 1) continue;
    serializedDeck.cards[name] = { ...card, detail: undefined };
    if (!mostPopularCard || card.detail.popularity > mostPopularCard?.detail?.popularity) {
      mostPopularCard = card;
    }
  }

  for (const [name, card] of Object.entries(deck.inPlay ?? {})) {
    if (card.qty < 1) continue;
    serializedDeck.inPlay[name] = { ...card, detail: undefined };
    if (!mostPopularCard || card.detail.popularity > mostPopularCard?.detail?.popularity) {
      mostPopularCard = card;
    }
  }
  serializedDeck.coverImage = getCardArtImage(mostPopularCard!);
  return serializedDeck;
}

function getCardSystemStore() {
  let stateString = localStorage.getItem(`card-systems`);
  if (!stateString) return { systems: {}, system: '' };
  let state = JSON.parse(stateString);
  for (const [name, system] of Object.entries(state.systems)) {
    if (!system) {
      delete state.systems[name];
    }
  }
  return state;
}

export function CardSystemProvider(props: ParentProps) {
  const [store, setStore] = createStore<CardSystemStore>({ systems: {}, system: '' });
  const [searchParams, setSearchParams] = useSearchParams();

  const init = getCardSystemStore();
  setStore(init);

  const updateStore: typeof setStore = (...update: any[]) => {
    (setStore as any)(...update);
    let raw = unwrap(store);
    localStorage.setItem('card-systems', JSON.stringify(raw));
  };

  async function initCardSystem(uri = DEFAULT_CARD_SYSTEM_URI) {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Failed to load card system');
    const system = await response.json();
    system.uri = uri;

    updateStore('systems', system.id, system);
    updateStore('system', system.id);
    setGlobalCardSystem(system);
    return system;
  }

  onMount(async () => {
    let systemUri = searchParams.system;
    if (systemUri && typeof systemUri === 'string') {
      await initCardSystem(systemUri);
      setSearchParams({ system: undefined }, { replace: true });
    } else {
      systemUri = store.systems[store.system]?.uri;
      await initCardSystem(systemUri);
    }
  });

  async function setCardSystem(systemId: string) {
    let system = store.systems[systemId];
    if (!system) {
      throw new Error(`system ${systemId} not found`);
    }
    return await initCardSystem(system.uri);
  }

  return (
    <CardSystemContext.Provider
      value={[store, { update: updateStore, setCardSystem, initCardSystem }]}>
      {props.children}
    </CardSystemContext.Provider>
  );
}
