import { toast } from 'solid-sonner';
import {
  deckStoreHasEmbeddedDetails,
  PersistedDeckStore,
  serializeDeckStoreForPersistence,
} from './deckSerialize';

const LS_KEY = 'mtgplayer-decks';
const LEGACY_LS_KEY = 'decks';
const IDB_NAME = 'arcanetable-deck-store';
const IDB_VERSION = 1;
const IDB_RECORD_KEY = 'primary';

interface PersistedDeckStoreRecord {
  key: string;
  updatedAt: number;
  store: PersistedDeckStore;
}

let idbPromise: Promise<IDBDatabase | null> | undefined;
let memoryDeckStore: PersistedDeckStore | undefined;
let idbHydrated = false;

function openDeckStoreDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (idbPromise) return idbPromise;

  idbPromise = new Promise(resolve => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('store')) {
        db.createObjectStore('store', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return idbPromise;
}

async function readDeckStoreFromIndexedDB(): Promise<PersistedDeckStore | null> {
  const db = await openDeckStoreDb();
  if (!db) return null;

  return new Promise(resolve => {
    const tx = db.transaction('store', 'readonly');
    const request = tx.objectStore('store').get(IDB_RECORD_KEY);
    request.onsuccess = () => {
      const record = request.result as PersistedDeckStoreRecord | undefined;
      resolve(record?.store ?? null);
    };
    request.onerror = () => resolve(null);
  });
}

async function writeDeckStoreToIndexedDB(store: PersistedDeckStore): Promise<boolean> {
  const db = await openDeckStoreDb();
  if (!db) return false;

  const record: PersistedDeckStoreRecord = {
    key: IDB_RECORD_KEY,
    updatedAt: Date.now(),
    store,
  };

  return new Promise(resolve => {
    const tx = db.transaction('store', 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.objectStore('store').put(record);
  });
}

function writeDeckStoreToLocalStorage(store: PersistedDeckStore): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return false;
    }
    throw error;
  }
}

export function persistDeckStore(rawStore: PersistedDeckStore, options?: { quiet?: boolean }) {
  const store = serializeDeckStoreForPersistence(rawStore);
  memoryDeckStore = store;

  void (async () => {
    const idbOk = await writeDeckStoreToIndexedDB(store);
    const lsOk = writeDeckStoreToLocalStorage(store);

    if (!idbOk && !lsOk && !options?.quiet) {
      toast.error(
        'No se pudieron guardar los mazos: almacenamiento lleno. Prueba a borrar mazos o limpiar datos del sitio.',
      );
    }
  })();
}

export function hydrateDeckStoreFromIndexedDB(onLoaded: (store: PersistedDeckStore) => void) {
  if (idbHydrated || typeof window === 'undefined') return;
  idbHydrated = true;

  void (async () => {
    const fromIdb = await readDeckStoreFromIndexedDB();
    if (!fromIdb) return;
    memoryDeckStore = serializeDeckStoreForPersistence(fromIdb);
    onLoaded(memoryDeckStore);
  })();
}

export function rememberDeckStoreInMemory(store: PersistedDeckStore) {
  memoryDeckStore = store;
}

export function getMemoryDeckStore(): PersistedDeckStore | undefined {
  return memoryDeckStore;
}

export function normalizeAndMaybeMigrateDeckStore(
  store: PersistedDeckStore,
  persist: (store: PersistedDeckStore) => void,
): PersistedDeckStore {
  if (deckStoreHasEmbeddedDetails(store)) {
    store = serializeDeckStoreForPersistence(store);
    persist(store);
  }
  return store;
}
