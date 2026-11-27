import { createSignal } from 'solid-js';
import { toast } from 'solid-sonner';
import type { Deck } from './constants';
import {
  flushPendingDeckStore,
  getDeckScope,
  getMemoryDeckStore,
  onDeckStorePersisted,
  readScopeDeckStore,
  replaceCurrentDeckStore,
  switchDeckScope,
  type DeckScope,
} from './deckPersistence';
import { serializeDeck, type PersistedDeckStore } from './deckSerialize';
import { getDeckStore } from './deckStore';
import { MTG_CARD_SYSTEM } from './mtgCardSystem';
import { supabase } from './supabase';
import {
  deckToRemote,
  hashString,
  remoteToDeck,
  stableStringify,
  type RemoteDeckRow,
} from './deckSyncMapping';

/*
 * Signed-in deck sync.
 * Supabase is the source of truth; the account's local copy (IndexedDB) is a cache the
 * app reads from. `synced` keeps, per deck, a hash of the version last confirmed on the
 * server, so we can tell local edits and remote changes apart, even across reloads or
 * offline periods.
 *
 * Safety rule: a deck is only deleted on the server when the user deleted it on purpose
 * (`markDeckDeleted`, kept in `deleted`). A deck that is merely missing from the local
 * cache (empty/failed cache, storage cleared, offline boot...) is restored from the
 * server instead of being deleted there.
 */

const SYNC_DEBOUNCE_MS = 1000;
const RETRY_MS = 30_000;

function deckHash(deck: Deck) {
  return hashString(stableStringify(serializeDeck(deck)));
}

/** Like deckHash, but ignores bookkeeping that doesn't count as editing the deck. */
function deckContentHash(deck: Deck) {
  const { lastUsedAt: _lastUsedAt, ...content } = serializeDeck(deck);
  return hashString(stableStringify(content));
}

// ---------- synced-state bookkeeping ----------

function syncedKey(uid: string) {
  return `mtgplayer-deck-synced:${uid}`;
}

function loadSynced(uid: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(syncedKey(uid)) ?? '{}');
  } catch {
    return {};
  }
}

function saveSynced(uid: string, synced: Record<string, string>) {
  try {
    localStorage.setItem(syncedKey(uid), JSON.stringify(synced));
  } catch {
    // Worst case we re-upload some decks next time.
  }
}

function loadRecord<T>(key: string): Record<string, T> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveRecord(key: string, record: Record<string, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Without it conflicts fall back to the server's version.
  }
}

/** Server `updated_at` of each deck as of the last sync. */
function syncedAtKey(uid: string) {
  return `mtgplayer-deck-synced-at:${uid}`;
}

/** When each deck was last edited here (ms), for decks with local edits. */
function editedAtKey(uid: string) {
  return `mtgplayer-deck-edited-at:${uid}`;
}

function deletedKey(uid: string) {
  return `mtgplayer-deck-deleted:${uid}`;
}

function loadDeleted(uid: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(deletedKey(uid)) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDeleted(uid: string, ids: Set<string>) {
  try {
    localStorage.setItem(deletedKey(uid), JSON.stringify([...ids]));
  } catch {
    // If this fails the deck just comes back from the server: safe side.
  }
}

// ---------- state ----------

let account: string | null = null;
let synced: Record<string, string> = {};
let syncedAt: Record<string, string> = {};
let editedAt: Record<string, number> = {};
/** Last seen content of each local deck, to notice real edits. */
const contentHashes = new Map<string, string>();
/** Decks the user explicitly deleted here; only these are deleted on the server. */
let deleted = new Set<string>();
/** Decks just taken from the server: their next local save marks them as synced. */
const adoptOnPersist = new Set<string>();
let ready = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncRunning = false;
let syncAgain = false;
let errorShown = false;
let accountChange: Promise<void> = Promise.resolve();

export type UploadCandidate = { deck: Deck; cardCount: number };
const [uploadCandidates, setUploadCandidates] = createSignal<UploadCandidate[]>([]);
export { uploadCandidates };

const [syncing, setSyncing] = createSignal(false);
export { syncing as deckSyncInProgress };

function promptFlagKey(uid: string) {
  return `mtgplayer-deck-upload-prompted:${uid}`;
}

function saveBookkeeping(uid: string) {
  saveSynced(uid, synced);
  saveRecord(syncedAtKey(uid), syncedAt);
  saveRecord(editedAtKey(uid), editedAt);
}

function forgetDeck(id: string) {
  delete synced[id];
  delete syncedAt[id];
  delete editedAt[id];
}

function rememberContent(store: { decks: Record<string, Deck> }) {
  contentHashes.clear();
  for (const [id, deck] of Object.entries(store.decks)) contentHashes.set(id, deckContentHash(deck));
}

onDeckStorePersisted((scope, store) => {
  if (!account || scope !== account) return;
  const now = Date.now();
  for (const [id, deck] of Object.entries(store.decks)) {
    const content = deckContentHash(deck);
    if (ready && adoptOnPersist.delete(id)) {
      synced[id] = deckHash(deck);
      delete editedAt[id];
    } else if (contentHashes.has(id) && contentHashes.get(id) !== content) {
      editedAt[id] = now;
    }
    contentHashes.set(id, content);
  }
  saveBookkeeping(account);
  if (ready) scheduleSync();
});

const REFRESH_ON_FOCUS_MS = 30_000;
let lastPull = 0;

/** A tab left open can hold old decks: fetch the server's when the user comes back. */
function refreshFromServer() {
  if (!account || !ready || syncRunning) return;
  if (Date.now() - lastPull < REFRESH_ON_FOCUS_MS) return;
  const uid = account;
  void pullAndMerge(uid).then(pulled => {
    if (pulled && account === uid) scheduleSync(0);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => scheduleSync(0));
  window.addEventListener('focus', refreshFromServer);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromServer();
  });
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void runSync(), delay);
}

async function runSync() {
  if (!supabase || !account || !ready) return;
  if (syncRunning) {
    syncAgain = true;
    return;
  }
  syncRunning = true;
  setSyncing(true);
  const uid = account;
  let failed = false;
  let missingLocally = false;

  try {
    const store = getMemoryDeckStore();
    if (!store || getDeckScope() !== uid) return;

    // Only write with a session that belongs to this account.
    const { data: sessionData } = await supabase.auth.getSession();
    if (account !== uid) return;
    const sessionOk = sessionData.session?.user.id === uid;
    if (!sessionOk) failed = true;

    for (const [id, deck] of sessionOk ? Object.entries(store.decks) : []) {
      const hash = deckHash(deck);
      if (synced[id] === hash) continue;
      const { deck: p_deck, cards: p_cards } = deckToRemote({ ...deck, id });
      const { data, error } = await supabase.rpc('save_deck', { p_deck, p_cards });
      if (account !== uid) return;
      if (error) {
        failed = true;
        console.error('[deckSync] save failed', id, error);
        continue;
      }
      synced[id] = hash;
      if (typeof data === 'string') syncedAt[id] = data;
      delete editedAt[id];
      saveBookkeeping(uid);
    }

    // Server deletes happen only for decks the user deleted on purpose.
    for (const id of sessionOk ? [...deleted] : []) {
      if (store.decks[id]) {
        // Brought back (e.g. re-imported): keep it.
        deleted.delete(id);
        saveDeleted(uid, deleted);
        continue;
      }
      const { error } = await supabase.from('decks').delete().eq('id', id);
      if (account !== uid) return;
      if (error) {
        failed = true;
        console.error('[deckSync] delete failed', id, error);
        continue;
      }
      deleted.delete(id);
      saveDeleted(uid, deleted);
      forgetDeck(id);
      saveBookkeeping(uid);
    }

    // Synced decks missing here without an explicit delete: restore them, never delete.
    missingLocally =
      sessionOk && Object.keys(synced).some(id => !store.decks[id] && !deleted.has(id));
  } finally {
    syncRunning = false;
    setSyncing(false);
  }

  if (missingLocally && account === uid) {
    console.warn('[deckSync] decks missing from the local cache; restoring from the server');
    await pullAndMerge(uid);
  }

  if (failed) {
    if (!errorShown) {
      errorShown = true;
      toast.error('Could not sync your decks. Changes are saved locally and will retry.');
    }
    scheduleSync(RETRY_MS);
  } else {
    errorShown = false;
  }
  if (syncAgain) {
    syncAgain = false;
    scheduleSync(0);
  }
}

type RemoteDeck = { deck: Deck; updatedAt: string | undefined };

async function fetchRemoteDecks(): Promise<RemoteDeck[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('decks')
    .select('*, deck_cards(*)')
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[deckSync] fetch failed', error);
    return null;
  }
  return (data as RemoteDeckRow[]).map(row => ({ deck: remoteToDeck(row), updatedAt: row.updated_at }));
}

function buildSystems(decks: Record<string, Deck>, previous: Record<string, string[]>) {
  const systems: Record<string, string[]> = {};
  const placed = new Set<string>();
  for (const [system, ids] of Object.entries(previous ?? {})) {
    for (const id of ids ?? []) {
      const deck = decks[id];
      if (!deck || placed.has(id)) continue;
      const target = deck.system || system;
      (systems[target] ??= []).push(id);
      placed.add(id);
    }
  }
  for (const [id, deck] of Object.entries(decks)) {
    if (placed.has(id)) continue;
    (systems[deck.system || MTG_CARD_SYSTEM.id] ??= []).push(id);
  }
  return systems;
}

function sameTime(a: string | undefined, b: string | undefined) {
  return !!a && !!b && Date.parse(a) === Date.parse(b);
}

/**
 * A deck changed here since the last sync. Keep the local version only if the server's
 * copy hasn't changed since then, or if the local edit is newer than the server's.
 * Otherwise (e.g. a stale copy on a device that was idle) the server wins.
 */
function keepLocalEdit(id: string, remoteUpdatedAt: string | undefined) {
  if (sameTime(syncedAt[id], remoteUpdatedAt)) return true;
  const localEdit = editedAt[id];
  const remoteTime = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : NaN;
  return !!localEdit && !(remoteTime >= localEdit);
}

function withLatestUse(deck: Deck, other: Deck | undefined): Deck {
  const lastUsedAt = Math.max(deck.lastUsedAt ?? 0, other?.lastUsedAt ?? 0);
  return lastUsedAt ? { ...deck, lastUsedAt } : deck;
}

/** Merges server decks with the account's local cache. */
async function pullAndMerge(uid: string) {
  lastPull = Date.now();
  const remote = await fetchRemoteDecks();
  if (account !== uid) return false;
  if (!remote) {
    // Offline or server error: keep working from the local cache and retry later.
    ready = true;
    scheduleSync(RETRY_MS);
    return false;
  }

  flushPendingDeckStore(); // edits made while fetching
  const local = getMemoryDeckStore() ?? { decks: {}, systems: {} };
  const merged: Record<string, Deck> = {};
  adoptOnPersist.clear();

  // An empty answer while we know of synced decks usually means a bad/expired session
  // (RLS returns no rows instead of an error). Don't treat it as "everything deleted".
  const trustRemoteDeletes = remote.length > 0 || Object.keys(synced).length === 0;

  const remoteById = new Map(remote.map(entry => [entry.deck.id, entry]));
  for (const [id, { deck: remoteDeck, updatedAt }] of remoteById) {
    const localDeck = local.decks[id];
    const wasSynced = id in synced;
    if (
      localDeck &&
      wasSynced &&
      deckHash(localDeck) !== synced[id] &&
      keepLocalEdit(id, updatedAt)
    ) {
      merged[id] = withLatestUse(localDeck, remoteDeck); // edited here since last sync: push it
    } else if (!localDeck && deleted.has(id)) {
      // deleted here on purpose: leave it out so the sync deletes it
    } else {
      // Includes decks missing from the local cache for any other reason: restore them.
      merged[id] = withLatestUse(remoteDeck, localDeck);
      adoptOnPersist.add(id);
      if (updatedAt) syncedAt[id] = updatedAt;
      if (deleted.delete(id)) saveDeleted(uid, deleted);
    }
  }

  for (const [id, localDeck] of Object.entries(local.decks)) {
    if (remoteById.has(id)) continue;
    const wasSynced = id in synced;
    if (trustRemoteDeletes && wasSynced && deckHash(localDeck) === synced[id]) {
      forgetDeck(id); // deleted on another device
      continue;
    }
    merged[id] = localDeck; // new here (or edited here after a remote delete): push it
    if (wasSynced) {
      delete synced[id];
      delete syncedAt[id];
    }
  }

  saveBookkeeping(uid);
  ready = true;
  replaceCurrentDeckStore({ decks: merged, systems: buildSystems(merged, local.systems) });
  return true;
}

async function findUploadCandidates(uid: string) {
  const anon = await readScopeDeckStore(null);
  const current = getMemoryDeckStore();
  if (!anon || !current || account !== uid) return;
  const candidates = Object.entries(anon.decks)
    .filter(([id, deck]) => id && deck && !current.decks[id])
    .map(([id, deck]) => ({
      deck: { ...deck, id },
      cardCount: Object.values(deck.cards ?? {}).reduce((sum, card) => sum + (card.qty ?? 1), 0),
    }));
  setUploadCandidates(candidates);
}

async function activate(uid: string) {
  account = uid;
  ready = false;
  synced = loadSynced(uid);
  syncedAt = loadRecord<string>(syncedAtKey(uid));
  editedAt = loadRecord<number>(editedAtKey(uid));
  deleted = loadDeleted(uid);
  contentHashes.clear();
  await switchDeckScope(uid, getDeckStore);
  if (account !== uid) return;
  rememberContent(getMemoryDeckStore() ?? { decks: {} });

  const pulled = await pullAndMerge(uid);
  if (!pulled || account !== uid) return;

  let prompted = false;
  try {
    prompted = sessionStorage.getItem(promptFlagKey(uid)) === '1';
    sessionStorage.setItem(promptFlagKey(uid), '1');
  } catch {
    // Without sessionStorage we just ask every time.
  }
  if (!prompted) await findUploadCandidates(uid);
}

async function deactivate(previous: string | null) {
  account = null;
  ready = false;
  clearTimeout(syncTimer);
  adoptOnPersist.clear();
  setUploadCandidates([]);
  if (previous) {
    try {
      sessionStorage.removeItem(promptFlagKey(previous));
    } catch {
      // ignore
    }
  }
  await switchDeckScope(null, getDeckStore);
}

/** Point deck storage at the signed-in account (or back to local decks when null). */
export function setDeckAccount(uid: DeckScope) {
  if (!supabase) return;
  accountChange = accountChange.then(async () => {
    if (uid === account && uid === getDeckScope()) return;
    const previous = account ?? getDeckScope();
    if (uid) await activate(uid);
    else await deactivate(previous);
  });
}

/** Copies the chosen local decks into the account; they upload on the next sync. */
export function uploadLocalDecks(deckIds: string[]) {
  const current = getMemoryDeckStore();
  if (!current || !account) return;
  const chosen = new Set(deckIds);
  const toAdd = uploadCandidates().filter(candidate => chosen.has(candidate.deck.id));
  if (!toAdd.length) return;

  const decks = { ...current.decks };
  for (const { deck } of toAdd) decks[deck.id] = deck;
  replaceCurrentDeckStore({ decks, systems: buildSystems(decks, current.systems) });
  setUploadCandidates([]);
}

/**
 * Call when the user deletes a deck on purpose. Only decks marked here are deleted on
 * the server; anything else missing locally is restored from it.
 */
export function markDeckDeleted(deckId: string) {
  if (!account || getDeckScope() !== account) return;
  deleted.add(deckId);
  saveDeleted(account, deleted);
}

export function dismissUploadPrompt() {
  setUploadCandidates([]);
}

export type { PersistedDeckStore };
