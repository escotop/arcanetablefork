import { CardEntry, CardEntryDetail } from './constants';
import {
  normalizePrintingCollectorNumber,
  normalizePrintingSetCode,
} from './deckPrinting';

export interface CachedPrintingsResponse {
  data: Array<{
    id: string;
    name: string;
    set?: string;
    set_name?: string;
    collector_number?: string;
    lang?: string;
    released_at?: string;
    image_uris?: CardEntryDetail['image_uris'];
    card_faces?: Array<Pick<CardEntryDetail, 'image_uris' | 'name'>>;
  }>;
  page: number;
  total_pages: number;
  total_cards: number;
}

const DB_NAME = 'arcanetable-scryfall-cache';
const DB_VERSION = 1;
const CARDS_STORE = 'cards';
const PRINTINGS_STORE = 'printings';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;

interface CachedCardRecord {
  key: string;
  detail: CardEntryDetail;
  fetchedAt: number;
  schemaVersion: number;
}

interface CachedPrintingsRecord {
  key: string;
  response: CachedPrintingsResponse;
  fetchedAt: number;
  schemaVersion: number;
}

const memoryCardCache = new Map<string, CardEntryDetail>();
const memoryPrintingsCache = new Map<string, CachedPrintingsResponse>();

let dbPromise: Promise<IDBDatabase | null> | undefined;

function isCacheFresh(fetchedAt: number) {
  return Date.now() - fetchedAt < CACHE_TTL_MS;
}

function cardIdKey(id: string) {
  return `id:${id}`;
}

function setCollectorKey(set: string, collectorNumber: string) {
  return `set:${set}:${collectorNumber}`;
}

export function printingsCacheKey(name: string, page: number, query?: string) {
  return `${name}\0${page}\0${query ?? ''}`;
}

export function slimCardDetail(detail: CardEntryDetail): CardEntryDetail {
  const slimFaces = detail.card_faces?.map(face => ({
    name: face.name,
    image_uris: face.image_uris,
    type_line: face.type_line,
    oracle_text: face.oracle_text,
    effect: face.effect,
    mana_cost: face.mana_cost,
    power: face.power,
    toughness: face.toughness,
    search: face.search,
    popularity: face.popularity,
  }));

  return {
    id: (detail as CardEntryDetail & { id?: string }).id,
    name: detail.name,
    set: detail.set,
    collector_number: detail.collector_number,
    type_line: detail.type_line,
    type: detail.type,
    image_uris: detail.image_uris ?? {},
    card_faces: slimFaces as CardEntryDetail['card_faces'],
    oracle_text: detail.oracle_text,
    effect: detail.effect,
    flavor: detail.flavor,
    mana_cost: detail.mana_cost,
    power: detail.power,
    toughness: detail.toughness,
    search: detail.search,
    popularity: detail.popularity,
    lang: (detail as CardEntryDetail & { lang?: string }).lang,
    set_name: (detail as CardEntryDetail & { set_name?: string }).set_name,
    released_at: (detail as CardEntryDetail & { released_at?: string }).released_at,
  } as CardEntryDetail;
}

function cacheKeysForDetail(detail: CardEntryDetail, entry?: CardEntry) {
  const keys = new Set<string>();
  const id = (detail as CardEntryDetail & { id?: string }).id ?? entry?.id;
  if (id) keys.add(cardIdKey(id));

  const set =
    normalizePrintingSetCode(entry?.set ?? detail.set) ??
    normalizePrintingSetCode(detail.set);
  const collector =
    normalizePrintingCollectorNumber(entry?.collector_number ?? detail.collector_number) ??
    normalizePrintingCollectorNumber(detail.collector_number);

  if (set && collector) {
    keys.add(setCollectorKey(set, collector));
  }

  return [...keys];
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CARDS_STORE)) {
        db.createObjectStore(CARDS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(PRINTINGS_STORE)) {
        db.createObjectStore(PRINTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
}

async function readRecord<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise(resolve => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

async function writeRecord(storeName: string, value: object) {
  const db = await openDb();
  if (!db) return;

  await new Promise<void>(resolve => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function readCardRecord(key: string): Promise<CardEntryDetail | null> {
  const cached = memoryCardCache.get(key);
  if (cached) return cached;

  const record = await readRecord<CachedCardRecord>(CARDS_STORE, key);
  if (!record || record.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  if (!isCacheFresh(record.fetchedAt)) return null;

  memoryCardCache.set(key, record.detail);
  return record.detail;
}

export async function getCachedCardById(id: string): Promise<CardEntryDetail | null> {
  return readCardRecord(cardIdKey(id));
}

export async function getCachedCardDetail(entry: CardEntry): Promise<CardEntryDetail | null> {
  if (entry.id) {
    const byId = await readCardRecord(cardIdKey(entry.id));
    if (byId) return byId;
  }

  const set = normalizePrintingSetCode(entry.set);
  const collector = normalizePrintingCollectorNumber(entry.collector_number);
  if (set && collector) {
    return readCardRecord(setCollectorKey(set, collector));
  }

  return null;
}

export async function setCachedCardDetail(detail: CardEntryDetail, entry?: CardEntry) {
  const slim = slimCardDetail(detail);
  const keys = cacheKeysForDetail(slim, entry);
  if (!keys.length) return;

  const fetchedAt = Date.now();
  for (const key of keys) {
    memoryCardCache.set(key, slim);
    await writeRecord(CARDS_STORE, {
      key,
      detail: slim,
      fetchedAt,
      schemaVersion: CACHE_SCHEMA_VERSION,
    } satisfies CachedCardRecord);
  }
}

export async function setCachedCardDetailsFromRaw(cards: Array<Record<string, unknown>>) {
  await Promise.all(
    cards.map(async raw => {
      const detail = raw as CardEntryDetail;
      if (!detail?.name) return;
      await setCachedCardDetail(detail);
    }),
  );
}

export async function getCachedPrintings(key: string): Promise<CachedPrintingsResponse | null> {
  const cached = memoryPrintingsCache.get(key);
  if (cached) return cached;

  const record = await readRecord<CachedPrintingsRecord>(PRINTINGS_STORE, key);
  if (!record || record.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  if (!isCacheFresh(record.fetchedAt)) return null;

  memoryPrintingsCache.set(key, record.response);
  return record.response;
}

export async function setCachedPrintings(key: string, response: CachedPrintingsResponse) {
  memoryPrintingsCache.set(key, response);
  await writeRecord(PRINTINGS_STORE, {
    key,
    response,
    fetchedAt: Date.now(),
    schemaVersion: CACHE_SCHEMA_VERSION,
  } satisfies CachedPrintingsRecord);
}
