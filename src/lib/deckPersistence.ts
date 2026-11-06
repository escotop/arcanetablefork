import { toast } from 'solid-sonner';
import {
  deckStoreHasEmbeddedDetails,
  PersistedDeckStore,
  serializeDeckStoreForPersistence,
} from './deckSerialize';

const LS_KEY = 'mtgplayer-decks';
const LEGACY_LS_KEY = 'decks';
const SCOPE_LS_KEY = 'mtgplayer-deck-scope';
const IDB_NAME = 'arcanetable-deck-store';
const IDB_VERSION = 1;
const ANON_RECORD_KEY = 'primary';

interface PersistedDeckStoreRecord {
  key: string;
  updatedAt: number;
  store: PersistedDeckStore;
}

/**
 * Decks are stored per "scope": the anonymous scope (null) uses the original keys,
 * and each signed-in account gets its own copy keyed by user id.
 */
export type DeckScope = string | null;

type ScopeListener = {
  /** Write any pending changes before the scope switches. */
  flush: () => void;
  /** Replace the in-memory store with another scope's data. */
  replace: (store: PersistedDeckStore) => void;
};

let idbPromise: Promise<IDBDatabase | null> | undefined;
let memoryDeckStore: PersistedDeckStore | undefined;
const hydratedScopes = new Set<string>();
const scopeListeners = new Set<ScopeListener>();
const persistListeners = new Set<(scope: DeckScope, store: PersistedDeckStore) => void>();

let currentScope: DeckScope = readSavedScope();

function readSavedScope(): DeckScope {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(SCOPE_LS_KEY) || null : null;
  } catch {
    return null;
  }
}

function recordKey(scope: DeckScope) {
  return scope ? `user:${scope}` : ANON_RECORD_KEY;
}

function lsKey(scope: DeckScope) {
  return scope ? `${LS_KEY}:${scope}` : LS_KEY;
}

export function getDeckScope(): DeckScope {
  return currentScope;
}

/** Raw JSON from localStorage for a scope (anonymous scope also checks the legacy key). */
export function readLocalStorageDeckStoreString(scope: DeckScope = currentScope): string | null {
  try {
    const value = localStorage.getItem(lsKey(scope));
    if (value || scope) return value;
    return localStorage.getItem(LEGACY_LS_KEY);
  } catch {
    return null;
  }
}

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

async function readDeckStoreFromIndexedDB(scope: DeckScope): Promise<PersistedDeckStore | null> {
  const db = await openDeckStoreDb();
  if (!db) return null;

  return new Promise(resolve => {
    const tx = db.transaction('store', 'readonly');
    const request = tx.objectStore('store').get(recordKey(scope));
    request.onsuccess = () => {
      const record = request.result as PersistedDeckStoreRecord | undefined;
      resolve(record?.store ?? null);
    };
    request.onerror = () => resolve(null);
  });
}

async function writeDeckStoreToIndexedDB(
  scope: DeckScope,
  store: PersistedDeckStore,
): Promise<boolean> {
  const db = await openDeckStoreDb();
  if (!db) return false;

  const record: PersistedDeckStoreRecord = {
    key: recordKey(scope),
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

function writeDeckStoreToLocalStorage(scope: DeckScope, store: PersistedDeckStore): boolean {
  try {
    localStorage.setItem(lsKey(scope), JSON.stringify(store));
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return false;
    }
    throw error;
  }
}

function writeScopeStore(scope: DeckScope, store: PersistedDeckStore, quiet?: boolean) {
  void (async () => {
    const idbOk = await writeDeckStoreToIndexedDB(scope, store);
    const lsOk = writeDeckStoreToLocalStorage(scope, store);

    if (!idbOk && !lsOk && !quiet) {
      toast.error(
        'No se pudieron guardar los mazos: almacenamiento lleno. Prueba a borrar mazos o limpiar datos del sitio.',
      );
    }
  })();
}

export function persistDeckStore(rawStore: PersistedDeckStore, options?: { quiet?: boolean }) {
  const store = serializeDeckStoreForPersistence(rawStore);
  const scope = currentScope;
  memoryDeckStore = store;
  writeScopeStore(scope, store, options?.quiet);
  for (const listener of persistListeners) listener(scope, store);
}

export function hydrateDeckStoreFromIndexedDB(onLoaded: (store: PersistedDeckStore) => void) {
  const key = recordKey(currentScope);
  if (hydratedScopes.has(key) || typeof window === 'undefined') return;
  hydratedScopes.add(key);
  const scope = currentScope;

  void (async () => {
    const fromIdb = await readDeckStoreFromIndexedDB(scope);
    if (!fromIdb || scope !== currentScope) return;
    memoryDeckStore = serializeDeckStoreForPersistence(fromIdb);
    onLoaded(memoryDeckStore);
  })();
}

/** Reads a scope's stored decks without switching to it (IndexedDB first, then localStorage). */
export async function readScopeDeckStore(scope: DeckScope): Promise<PersistedDeckStore | null> {
  if (scope === currentScope && memoryDeckStore) return memoryDeckStore;
  const fromIdb = await readDeckStoreFromIndexedDB(scope);
  if (fromIdb) return serializeDeckStoreForPersistence(fromIdb);
  const raw = readLocalStorageDeckStoreString(scope);
  if (!raw) return null;
  try {
    return serializeDeckStoreForPersistence(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Switches which scope the app reads and writes decks from.
 * `loadStore` builds the new scope's in-memory store (with migrations).
 */
export async function switchDeckScope(
  scope: DeckScope,
  loadStore: () => PersistedDeckStore,
): Promise<void> {
  if (scope === currentScope) return;

  for (const listener of scopeListeners) listener.flush();

  currentScope = scope;
  memoryDeckStore = undefined;
  try {
    if (scope) localStorage.setItem(SCOPE_LS_KEY, scope);
    else localStorage.removeItem(SCOPE_LS_KEY);
  } catch {
    // Ignore storage errors; scope just won't survive a reload.
  }

  let store = loadStore();
  replaceInListeners(store);

  const fromIdb = await readDeckStoreFromIndexedDB(scope);
  hydratedScopes.add(recordKey(scope));
  if (fromIdb && scope === currentScope) {
    store = serializeDeckStoreForPersistence(fromIdb);
    memoryDeckStore = store;
    replaceInListeners(store);
  }
}

/** Replaces the current scope's decks (e.g. after a server sync) and saves them. */
export function replaceCurrentDeckStore(store: PersistedDeckStore) {
  const serialized = serializeDeckStoreForPersistence(store);
  memoryDeckStore = serialized;
  replaceInListeners(serialized);
  persistDeckStore(serialized, { quiet: true });
}

function replaceInListeners(store: PersistedDeckStore) {
  memoryDeckStore = store;
  for (const listener of scopeListeners) listener.replace(store);
}

export function onDeckScopeChange(listener: ScopeListener) {
  scopeListeners.add(listener);
  return () => scopeListeners.delete(listener);
}

/** Called after every local save, with the scope it was saved to. */
export function onDeckStorePersisted(
  listener: (scope: DeckScope, store: PersistedDeckStore) => void,
) {
  persistListeners.add(listener);
  return () => persistListeners.delete(listener);
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
