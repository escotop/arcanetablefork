import { beforeEach, expect, test, vi } from 'vitest';
import type { Deck } from './constants';
import { deckToRemote } from './deckSyncMapping';

const UID = 'user-1';

type Row = ReturnType<typeof deckToRemote>['deck'] & { updated_at: string; deck_cards: unknown[] };
const server = new Map<string, Row>();
const saved: string[] = [];
let rpcFails = false;

function setServerDeck(deck: Deck, updatedAt: string) {
  const { deck: row, cards } = deckToRemote(deck);
  server.set(deck.id!, { ...row, updated_at: updatedAt, deck_cards: cards.map((c, i) => ({ ...c, position: i })) });
}

vi.mock('solid-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('./deck', () => ({ getDeckCoverMetadata: () => ({}) }));
vi.mock('./deckStore', async () => {
  const { readLocalStorageDeckStoreString } = await import('./deckPersistence');
  return {
    getDeckStore: () => JSON.parse(readLocalStorageDeckStoreString() ?? '{"decks":{},"systems":{}}'),
  };
});
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: UID } } } }) },
    from: () => ({
      select: () => ({ order: async () => ({ data: [...server.values()], error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    rpc: async (_name: string, { p_deck, p_cards }: any) => {
      if (rpcFails) return { data: null, error: new Error('offline') };
      const updatedAt = new Date().toISOString();
      saved.push(p_deck.id);
      server.set(p_deck.id, { ...p_deck, updated_at: updatedAt, deck_cards: p_cards.map((c: any, i: number) => ({ ...c, position: i })) });
      return { data: updatedAt, error: null };
    },
  },
}));

function deck(name: string, extra: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name,
    system: 'mtg',
    version: 2,
    startingLife: 40,
    cards: { 'Sol Ring': { id: 'c1', name: 'Sol Ring', qty: 1, set: 'cmm', categories: [] } as any },
    inPlay: {},
    sideboard: {},
    tokens: {},
    ...extra,
  } as Deck;
}

const storage = new Map<string, string>();

function setLocalDeck(value: Deck) {
  storage.set(`mtgplayer-decks:${UID}`, JSON.stringify({ decks: { d1: value }, systems: { mtg: ['d1'] } }));
}

async function signIn() {
  vi.resetModules();
  const sync = await import('./deckSync');
  const persistence = await import('./deckPersistence');
  sync.setDeckAccount(UID);
  await vi.waitFor(() => expect(persistence.getDeckScope()).toBe(UID));
  // Wait for the pull to land and any upload to finish.
  await vi.waitFor(() => expect(persistence.getMemoryDeckStore()?.decks.d1).toBeTruthy());
  await new Promise(resolve => setTimeout(resolve, 1100));
  await vi.waitFor(() => expect(sync.deckSyncInProgress()).toBe(false));
  return persistence;
}

beforeEach(() => {
  storage.clear();
  server.clear();
  saved.length = 0;
  rpcFails = false;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal('sessionStorage', { getItem: () => '1', setItem: () => {}, removeItem: () => {} });
});

test('a stale local copy does not overwrite a newer server version', async () => {
  // First sign-in: local and server agree.
  setServerDeck(deck('Old'), '2026-11-01T10:00:00.000Z');
  setLocalDeck(deck('Old'));
  await signIn();

  // Another device saves a newer version; here the deck was only played (lastUsedAt).
  setServerDeck(deck('New from other device'), '2026-11-20T10:00:00.000Z');
  setLocalDeck(deck('Old', { lastUsedAt: Date.now() }));
  storage.delete('mtgplayer-deck-scope');
  saved.length = 0;

  const persistence = await signIn();
  const local = persistence.getMemoryDeckStore()!.decks.d1;
  expect(local.name).toBe('New from other device');
  expect(local.lastUsedAt).toBeTruthy();
  expect(server.get('d1')!.name).toBe('New from other device');
});

test('state from before this fix: unknown sync time, the server wins', async () => {
  setServerDeck(deck('New'), '2026-11-20T10:00:00.000Z');
  setLocalDeck(deck('Old', { lastUsedAt: 5 }));
  // Old bookkeeping: synced hash of some earlier version, no synced-at / edited-at.
  storage.set(`mtgplayer-deck-synced:${UID}`, JSON.stringify({ d1: 'stale-hash' }));

  const persistence = await signIn();
  expect(persistence.getMemoryDeckStore()!.decks.d1.name).toBe('New');
  expect(server.get('d1')!.name).toBe('New');
});

test('a local edit is kept and uploaded when the server has not changed', async () => {
  setServerDeck(deck('Old'), '2026-11-01T10:00:00.000Z');
  setLocalDeck(deck('Old'));
  const persistence = await signIn();

  // Edit, then "reload" before it could upload (e.g. offline).
  rpcFails = true;
  const store = persistence.getMemoryDeckStore()!;
  persistence.persistDeckStore({ ...store, decks: { d1: deck('Edited here') } });
  await new Promise(resolve => setTimeout(resolve, 1200));
  expect(server.get('d1')!.name).toBe('Old');
  rpcFails = false;
  storage.delete('mtgplayer-deck-scope');

  const reloaded = await signIn();
  expect(reloaded.getMemoryDeckStore()!.decks.d1.name).toBe('Edited here');
  expect(server.get('d1')!.name).toBe('Edited here');
});
