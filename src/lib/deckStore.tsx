import { createStore, SetStoreFunction, unwrap } from 'solid-js/store';
import { nanoid } from 'nanoid';
import { createContext, onMount, ParentProps, useContext } from 'solid-js';
import { CardEntry, Deck, DetailedCardEntry, CardSystem } from './constants';
import { fetchCardInfo, getDeckCoverMetadata, parseImportedCardList } from './deck';
import { buildImportedInPlay, fetchCardInfoForImport } from './deckImportLookup';
import { applyCustomArtToEntry } from './customCardArt';
import { hasRequestedPrinting, printingMatchesRequest } from './deckPrinting';
import { setCardSystem as setGlobalCardSystem } from './globals';
import { CardSystemContext } from './cardSystemContext';
import { MTG_CARD_SYSTEM, normalizeCardSystemId } from './mtgCardSystem';

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
    localStorage.setItem('mtgplayer-decks', JSON.stringify(raw));
  };

  return [store, updateStore] as const;
};

interface DeckStore {
  decks: Record<string, Deck>;
  systems: Record<string, CardSystem[]>;
}

export function getDeckStore(): DeckStore {
  let storeString = localStorage.getItem('mtgplayer-decks') ?? localStorage.getItem('decks');
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
    localStorage.setItem('mtgplayer-decks', JSON.stringify(store));
  }

  let migrated = false;

  Object.entries(store.decks ?? {}).forEach(([id, deck]) => {
    let nextDeck = deck;

    if (!deck.id) {
      nextDeck = { ...nextDeck, id };
      migrated = true;
    }

    const normalizedSystem = normalizeCardSystemId(nextDeck.system);
    if (nextDeck.system !== normalizedSystem) {
      nextDeck = { ...nextDeck, system: normalizedSystem };
      migrated = true;
    }

    if (nextDeck !== deck) {
      store.decks[id] = nextDeck;
    }
  });

  if (migrated) {
    localStorage.setItem('mtgplayer-decks', JSON.stringify(store));
  }

  const legacySystemIds = ['scry-server-mtg', 'unsorted'];
  for (const legacyId of legacySystemIds) {
    const legacyDecks = store.systems?.[legacyId];
    if (!legacyDecks?.length) continue;
    store.systems[MTG_CARD_SYSTEM.id] = [
      ...new Set([...(store.systems[MTG_CARD_SYSTEM.id] ?? []), ...legacyDecks]),
    ];
    delete store.systems[legacyId];
    migrated = true;
  }

  if (migrated) {
    localStorage.setItem('mtgplayer-decks', JSON.stringify(store));
  }

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

async function hydrateCardEntries(
  entries: DetailedCardEntry[],
  cache: Map<string, DetailedCardEntry>,
  target: Record<string, DetailedCardEntry>,
) {
  const needingHydration = entries.filter(needsCardHydration);
  const ready = entries.filter(card => !needsCardHydration(card));

  for (const card of ready) {
    const updated = await applyCustomArtToEntry(card);
    target[getCardKey(updated)] = updated;
  }

  if (!needingHydration.length) return;

  const hydrated = await fetchCardInfoForImport(needingHydration, cache);
  for (const card of needingHydration) {
    const key = getCardKey(card);
    const updated = hydrated[key] ?? (await hydrateCardEntry(card, cache).catch(() => card));
    target[key] = await applyCustomArtToEntry(updated);
  }
}

export async function hydrateDeck(originalDeck: Deck) {
  let cache = new Map();

  let deck = structuredClone(originalDeck);

  if (deck.cardList) {
    const { cards: cardList, inPlayIndices } = parseImportedCardList(deck.cardList);
    deck.cardList = undefined;
    deck.deck = undefined;

    deck.cards = await fetchCardInfoForImport(cardList, cache);

    if (!Object.keys(deck.inPlay ?? {}).length && inPlayIndices.length) {
      deck.inPlay = buildImportedInPlay(cardList, inPlayIndices, deck.cards);
    } else if (deck.inPlay && Array.isArray(deck.inPlay)) {
      deck.inPlay = await fetchCardInfoForImport(deck.inPlay, cache);
    }
    deck.version = 2;
  }

  let deckCards = Object.values(deck.cards);
  let inPlayCards = Object.values(deck.inPlay ?? {});
  deck.cards = {};
  deck.inPlay = {};

  await hydrateCardEntries(deckCards, cache, deck.cards);

  const syncedInPlay = syncInPlayEntries(inPlayCards, deck.cards);
  await hydrateCardEntries(syncedInPlay, cache, deck.inPlay);

  deck = Object.assign({}, structuredClone(DEFAULT_DECK), deck);

  return deck;
}

export function serializeDeck(deck: Deck) {
  const serializedDeck = { ...deck, cards: {}, inPlay: {} };

  for (const [name, card] of Object.entries(deck.cards)) {
    if (card.qty < 1) continue;
    serializedDeck.cards[name] = { ...card, detail: undefined };
  }

  for (const [name, card] of Object.entries(deck.inPlay ?? {})) {
    if (card.qty < 1) continue;
    serializedDeck.inPlay[name] = { ...card, detail: undefined };
  }

  Object.assign(serializedDeck, getDeckCoverMetadata(deck));
  return serializedDeck;
}

export function CardSystemProvider(props: ParentProps) {
  const [store, setStore] = createStore<CardSystemStore>({
    systems: { [MTG_CARD_SYSTEM.id]: MTG_CARD_SYSTEM },
    system: MTG_CARD_SYSTEM.id,
  });

  const updateStore: typeof setStore = (...update: any[]) => {
    (setStore as any)(...update);
    let raw = unwrap(store);
    localStorage.setItem('mtgplayer-card-system', JSON.stringify(raw));
  };

  async function initCardSystem() {
    updateStore('systems', MTG_CARD_SYSTEM.id, MTG_CARD_SYSTEM);
    updateStore('system', MTG_CARD_SYSTEM.id);
    setGlobalCardSystem(MTG_CARD_SYSTEM);
    return MTG_CARD_SYSTEM;
  }

  onMount(() => {
    void initCardSystem();
  });

  async function setCardSystem(systemId: string) {
    const normalized = normalizeCardSystemId(systemId);
    if (normalized !== MTG_CARD_SYSTEM.id) {
      throw new Error(`Unknown card system: ${systemId}`);
    }
    return initCardSystem();
  }

  return (
    <CardSystemContext.Provider
      value={[store, { update: updateStore, setCardSystem, initCardSystem }]}>
      {props.children}
    </CardSystemContext.Provider>
  );
}

interface CardSystemStore {
  systems: Record<string, CardSystem>;
  system: string;
}
