import { Deck, DetailedCardEntry } from './constants';

const DB_NAME = 'arcanetable-deck-cache';
const DB_VERSION = 1;
const HYDRATED_STORE = 'hydrated';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;

interface HydratedDeckRecord {
  deckId: string;
  hash: string;
  deck: Deck;
  hydratedAt: number;
  schemaVersion: number;
}

let dbPromise: Promise<IDBDatabase | null> | undefined;

function isCacheFresh(hydratedAt: number) {
  return Date.now() - hydratedAt < CACHE_TTL_MS;
}

function normalizeEntries(entries: Record<string, DetailedCardEntry> | undefined) {
  return Object.entries(entries ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, card]) => ({
      key,
      id: card.id,
      name: card.name,
      qty: card.qty,
      set: card.set,
      collector_number: card.collector_number,
      customArtUrl: card.customArtUrl,
    }));
}

export function computeDeckContentHash(deck: Deck): string {
  return JSON.stringify({
    cardList: deck.cardList,
    cards: normalizeEntries(deck.cards),
    inPlay: normalizeEntries(deck.inPlay),
    sideboard: normalizeEntries(deck.sideboard),
    tokens: normalizeEntries(deck.tokens),
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HYDRATED_STORE)) {
        db.createObjectStore(HYDRATED_STORE, { keyPath: 'deckId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
}

export async function getHydratedDeck(deckId: string, hash: string): Promise<Deck | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise(resolve => {
    const tx = db.transaction(HYDRATED_STORE, 'readonly');
    const request = tx.objectStore(HYDRATED_STORE).get(deckId);
    request.onsuccess = () => {
      const record = request.result as HydratedDeckRecord | undefined;
      if (!record || record.schemaVersion !== CACHE_SCHEMA_VERSION) {
        resolve(null);
        return;
      }
      if (record.hash !== hash || !isCacheFresh(record.hydratedAt)) {
        resolve(null);
        return;
      }
      resolve(structuredClone(record.deck));
    };
    request.onerror = () => resolve(null);
  });
}

export async function setHydratedDeck(deckId: string, hash: string, deck: Deck) {
  const db = await openDb();
  if (!db) return;

  await new Promise<void>(resolve => {
    const tx = db.transaction(HYDRATED_STORE, 'readwrite');
    tx.objectStore(HYDRATED_STORE).put({
      deckId,
      hash,
      deck: structuredClone(deck),
      hydratedAt: Date.now(),
      schemaVersion: CACHE_SCHEMA_VERSION,
    } satisfies HydratedDeckRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
