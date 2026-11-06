import { createSignal } from 'solid-js';
import { toast } from 'solid-sonner';
import type { Deck } from './constants';
import {
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
 * server, so we can tell local edits, local deletes and remote changes apart, even
 * across reloads or offline periods.
 */

const SYNC_DEBOUNCE_MS = 1000;
const RETRY_MS = 30_000;

function deckHash(deck: Deck) {
  return hashString(stableStringify(serializeDeck(deck)));
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

// ---------- state ----------

let account: string | null = null;
let synced: Record<string, string> = {};
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

onDeckStorePersisted((scope, store) => {
  if (!account || scope !== account || !ready) return;
  for (const [id, deck] of Object.entries(store.decks)) {
    if (adoptOnPersist.delete(id)) synced[id] = deckHash(deck);
  }
  saveSynced(account, synced);
  scheduleSync();
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => scheduleSync(0));
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

  try {
    const store = getMemoryDeckStore();
    if (!store || getDeckScope() !== uid) return;

    for (const [id, deck] of Object.entries(store.decks)) {
      const hash = deckHash(deck);
      if (synced[id] === hash) continue;
      const { deck: p_deck, cards: p_cards } = deckToRemote({ ...deck, id });
      const { error } = await supabase.rpc('save_deck', { p_deck, p_cards });
      if (account !== uid) return;
      if (error) {
        failed = true;
        console.error('[deckSync] save failed', id, error);
        continue;
      }
      synced[id] = hash;
      saveSynced(uid, synced);
    }

    for (const id of Object.keys(synced)) {
      if (store.decks[id]) continue;
      const { error } = await supabase.from('decks').delete().eq('id', id);
      if (account !== uid) return;
      if (error) {
        failed = true;
        console.error('[deckSync] delete failed', id, error);
        continue;
      }
      delete synced[id];
      saveSynced(uid, synced);
    }
  } finally {
    syncRunning = false;
    setSyncing(false);
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

async function fetchRemoteDecks(): Promise<Deck[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('decks')
    .select('*, deck_cards(*)')
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[deckSync] fetch failed', error);
    return null;
  }
  return (data as RemoteDeckRow[]).map(remoteToDeck);
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

/** Merges server decks with the account's local cache. */
async function pullAndMerge(uid: string) {
  const remote = await fetchRemoteDecks();
  if (account !== uid) return false;
  if (!remote) {
    // Offline or server error: keep working from the local cache and retry later.
    ready = true;
    scheduleSync(RETRY_MS);
    return false;
  }

  const local = getMemoryDeckStore() ?? { decks: {}, systems: {} };
  const merged: Record<string, Deck> = {};
  adoptOnPersist.clear();

  const remoteById = new Map(remote.map(deck => [deck.id, deck]));
  for (const [id, remoteDeck] of remoteById) {
    const localDeck = local.decks[id];
    const wasSynced = id in synced;
    if (localDeck && wasSynced && deckHash(localDeck) !== synced[id]) {
      merged[id] = localDeck; // edited here since last sync: push it
    } else if (!localDeck && wasSynced) {
      // deleted here since last sync: leave it out so the sync deletes it
    } else {
      merged[id] = remoteDeck;
      adoptOnPersist.add(id);
    }
  }

  for (const [id, localDeck] of Object.entries(local.decks)) {
    if (remoteById.has(id)) continue;
    const wasSynced = id in synced;
    if (wasSynced && deckHash(localDeck) === synced[id]) {
      delete synced[id]; // deleted on another device
      continue;
    }
    merged[id] = localDeck; // new here (or edited here after a remote delete): push it
    if (wasSynced) delete synced[id];
  }

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
  await switchDeckScope(uid, getDeckStore);
  if (account !== uid) return;

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

export function dismissUploadPrompt() {
  setUploadCandidates([]);
}

export type { PersistedDeckStore };
