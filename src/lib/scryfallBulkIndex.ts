/**
 * Local card index built from Scryfall's bulk `oracle_cards` file (one printing per card,
 * ~25 MB gzipped JSONL from data.scryfall.io: no rate limit, CORS allowed).
 *
 * Used as the fallback when the Scryfall API is rate limited. Same data and image URLs as
 * Scryfall itself, unlike magicthegathering.io (1000 req/h, slow, Gatherer images missing
 * for recent sets). Built only once a player has actually needed a fallback, then kept
 * fresh weekly, so players who never hit limits never download it.
 */
import type { CardEntryDetail } from './constants';
import { devLog } from './devLog';
import { scryfallFetch, type ScryfallSearchResult } from './scryfall/client';
import { onScryfallFallbackActivated } from './scryfallFallback';

const DB_NAME = 'arcanetable-scryfall-bulk';
const DB_VERSION = 1;
const CARDS_STORE = 'cards';
const META_STORE = 'meta';
const META_KEY = 'oracle_cards';
const SEARCH_ROWS_KEY = 'search_rows';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_BATCH = 500;
const SEARCH_PAGE_SIZE = 60;
const ENABLED_KEY = 'arcanetable:scryfall-bulk-enabled';

type ImageUris = Record<string, string>;

interface BulkCardRecord {
  key: string;
  aliasOf?: string;
  card?: Record<string, unknown>;
}

interface BulkMeta {
  key: string;
  updatedAt: string;
  fetchedAt: number;
  count: number;
}

/** [normalized name, normalized type line, record key] for in-memory catalog search. */
type SearchRow = [string, string, string];

export function normalizeBulkName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const IMAGE_KEYS = ['small', 'normal', 'large', 'png', 'art_crop', 'border_crop'];

function slimImages(uris: unknown): ImageUris | undefined {
  if (!uris || typeof uris !== 'object') return undefined;
  const out: ImageUris = {};
  for (const key of IMAGE_KEYS) {
    const value = (uris as Record<string, unknown>)[key];
    if (typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

const CARD_KEYS = [
  'id',
  'oracle_id',
  'name',
  'lang',
  'layout',
  'set',
  'set_name',
  'collector_number',
  'released_at',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'power',
  'toughness',
  'loyalty',
  'defense',
  'colors',
  'color_identity',
  'keywords',
  'edhrec_rank',
  'rarity',
] as const;

const FACE_KEYS = ['name', 'mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense'];

/** Keep only what the deck editor and table need (the raw file is ~210 MB uncompressed). */
export function slimBulkCard(raw: Record<string, unknown>): Record<string, unknown> {
  const card: Record<string, unknown> = {};
  for (const key of CARD_KEYS) {
    if (raw[key] !== undefined) card[key] = raw[key];
  }
  const images = slimImages(raw.image_uris);
  if (images) card.image_uris = images;
  if (Array.isArray(raw.card_faces)) {
    card.card_faces = raw.card_faces.map(face => {
      const slim: Record<string, unknown> = {};
      for (const key of FACE_KEYS) {
        if ((face as Record<string, unknown>)[key] !== undefined) {
          slim[key] = (face as Record<string, unknown>)[key];
        }
      }
      const faceImages = slimImages((face as Record<string, unknown>).image_uris);
      if (faceImages) slim.image_uris = faceImages;
      return slim;
    });
  }
  if (Array.isArray(raw.all_parts)) {
    card.all_parts = raw.all_parts
      .filter(part => part && typeof part === 'object')
      .map(part => {
        const entry = part as Record<string, unknown>;
        return {
          id: entry.id,
          name: entry.name,
          component: entry.component,
          type_line: entry.type_line,
          uri: entry.uri,
        };
      });
  }
  return card;
}

function isTokenLike(card: Record<string, unknown>) {
  const layout = String(card.layout ?? '');
  return layout === 'token' || layout === 'double_faced_token' || layout === 'emblem';
}

// ---------------- IndexedDB ----------------

let dbPromise: Promise<IDBDatabase | null> | undefined;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CARDS_STORE)) db.createObjectStore(CARDS_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readMeta(db: IDBDatabase): Promise<BulkMeta | undefined> {
  const tx = db.transaction(META_STORE, 'readonly');
  return requestToPromise(tx.objectStore(META_STORE).get(META_KEY)) as Promise<BulkMeta | undefined>;
}

async function writeRecords(db: IDBDatabase, records: BulkCardRecord[]) {
  const tx = db.transaction(CARDS_STORE, 'readwrite');
  const store = tx.objectStore(CARDS_STORE);
  for (const record of records) store.put(record);
  await transactionDone(tx);
}

// ---------------- state ----------------

let ready: boolean | undefined;
let building: Promise<boolean> | undefined;
let searchRows: SearchRow[] | undefined;

function wasEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function markEnabled() {
  try {
    localStorage.setItem(ENABLED_KEY, '1');
  } catch {
    // private mode: the index still works for this session
  }
}

export async function isBulkIndexReady(): Promise<boolean> {
  if (ready !== undefined) return ready;
  const db = await openDb();
  if (!db) return (ready = false);
  try {
    const meta = await readMeta(db);
    ready = !!meta && meta.count > 0;
  } catch {
    ready = false;
  }
  return ready;
}

function yieldToUi() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function buildIndex(): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  if (typeof DecompressionStream === 'undefined' || typeof TextDecoderStream === 'undefined') {
    return false;
  }

  const metaResponse = await scryfallFetch('/bulk-data/oracle_cards', undefined, {
    priority: 'background',
    cooldownBudgetMs: 60_000,
  });
  if (!metaResponse.ok) return false;
  const bulk = (await metaResponse.json()) as {
    updated_at?: string;
    jsonl_download_uri?: string;
  };
  if (!bulk.jsonl_download_uri || !bulk.updated_at) return false;

  const existing = await readMeta(db).catch(() => undefined);
  if (existing?.updatedAt === bulk.updated_at && existing.count > 0) {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ ...existing, fetchedAt: Date.now() });
    await transactionDone(tx);
    return true;
  }

  const started = performance.now();
  const download = await fetch(bulk.jsonl_download_uri);
  if (!download.ok || !download.body) return false;

  type BytePair = ReadableWritablePair<Uint8Array, Uint8Array>;
  let body: ReadableStream<Uint8Array> = download.body;
  if (!download.headers.get('content-encoding') && bulk.jsonl_download_uri.endsWith('.gz')) {
    body = body.pipeThrough(new DecompressionStream('gzip') as unknown as BytePair);
  }
  const reader = body
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();

  const kinds = new Map<string, boolean>(); // key -> isToken (real cards win name clashes)
  const rows: SearchRow[] = [];
  let batch: BulkCardRecord[] = [];
  let count = 0;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (raw.object !== 'card' || typeof raw.name !== 'string') return;
    if (raw.layout === 'art_series') return; // collectible art cards, not playable
    const card = slimBulkCard(raw);
    const token = isTokenLike(card);
    const key = normalizeBulkName(raw.name);
    const previous = kinds.get(key);
    if (previous === false || (previous === true && token)) return;
    kinds.set(key, token);
    batch.push({ key, card });
    if (!token) rows.push([key, normalizeBulkName(String(card.type_line ?? '')), key]);
    count++;

    // "Front // Back" cards are often listed by their front face only.
    const front = raw.name.includes(' // ') ? normalizeBulkName(raw.name.split(' // ')[0]) : undefined;
    const frontKind = front ? kinds.get(front) : undefined;
    if (front && (frontKind === undefined || (frontKind === true && !token))) {
      kinds.set(front, token);
      batch.push({ key: front, aliasOf: key });
    }
  };

  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let start = 0;
    let newline: number;
    while ((newline = buffer.indexOf('\n', start)) !== -1) {
      handleLine(buffer.slice(start, newline));
      start = newline + 1;
    }
    buffer = buffer.slice(start);
    if (batch.length >= WRITE_BATCH) {
      await writeRecords(db, batch.splice(0));
      await yieldToUi();
    }
  }
  handleLine(buffer);
  if (batch.length) await writeRecords(db, batch.splice(0));
  if (!count) return false;

  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({
    key: META_KEY,
    updatedAt: bulk.updated_at,
    fetchedAt: Date.now(),
    count,
  } satisfies BulkMeta);
  tx.objectStore(META_STORE).put({ key: SEARCH_ROWS_KEY, rows });
  await transactionDone(tx);
  searchRows = rows;

  devLog.log(
    `[Scryfall bulk] indexed ${count} cards in ${Math.round(performance.now() - started)} ms`,
  );
  return true;
}

/** Build (or refresh) the index once; concurrent callers share the same run. */
export function ensureBulkIndex(): Promise<boolean> {
  if (!building) {
    building = buildIndex()
      .then(ok => {
        ready = ok || ready === true;
        return ok;
      })
      .catch(error => {
        devLog.warn('[Scryfall bulk] index build failed', error);
        return false;
      })
      .finally(() => {
        building = undefined;
      });
  }
  return building;
}

/**
 * Called when Scryfall becomes unavailable: remember that this player needs the fallback and
 * build the index in the background (it waits for Scryfall's metadata endpoint to recover).
 */
export function noteScryfallFallbackNeeded() {
  markEnabled();
  void scheduleBulkIndexRefresh();
}

onScryfallFallbackActivated(() => noteScryfallFallbackNeeded());

/** Refresh weekly for players who already rely on the index. */
export async function scheduleBulkIndexRefresh() {
  if (!wasEnabled() || building) return;
  const db = await openDb();
  if (!db) return;
  const meta = await readMeta(db).catch(() => undefined);
  if (meta && Date.now() - meta.fetchedAt < MAX_AGE_MS) {
    ready = meta.count > 0;
    return;
  }
  await ensureBulkIndex();
}

async function getRecord(db: IDBDatabase, key: string): Promise<BulkCardRecord | undefined> {
  const tx = db.transaction(CARDS_STORE, 'readonly');
  return requestToPromise(tx.objectStore(CARDS_STORE).get(key)) as Promise<BulkCardRecord | undefined>;
}

function toDetail(card: Record<string, unknown>): CardEntryDetail {
  const rank = typeof card.edhrec_rank === 'number' ? card.edhrec_rank : 99999;
  return {
    ...(card as unknown as CardEntryDetail),
    image_uris: (card.image_uris as CardEntryDetail['image_uris']) ?? {},
    popularity: rank,
    search: '',
  } as CardEntryDetail;
}

/** Exact (accent/case-insensitive) name lookup; null when unknown or the index is missing. */
export async function lookupBulkCard(name: string): Promise<CardEntryDetail | null> {
  if (!(await isBulkIndexReady())) return null;
  const db = await openDb();
  if (!db) return null;
  let record = await getRecord(db, normalizeBulkName(name)).catch(() => undefined);
  if (record?.aliasOf) record = await getRecord(db, record.aliasOf).catch(() => undefined);
  return record?.card ? toDetail(record.card) : null;
}

async function loadSearchRows(db: IDBDatabase): Promise<SearchRow[]> {
  if (searchRows) return searchRows;
  const tx = db.transaction(META_STORE, 'readonly');
  const stored = (await requestToPromise(tx.objectStore(META_STORE).get(SEARCH_ROWS_KEY))) as
    | { rows?: SearchRow[] }
    | undefined;
  searchRows = stored?.rows ?? [];
  return searchRows;
}

/**
 * Simple catalog search while Scryfall is down: every word must appear in the name, plus
 * type/subtype filters. (Full Scryfall syntax like o:"..." is not supported offline.)
 */
export async function searchBulkCards(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
): Promise<ScryfallSearchResult | null> {
  if (!(await isBulkIndexReady())) return null;
  const db = await openDb();
  if (!db) return null;

  const words = normalizeBulkName(q).split(' ').filter(Boolean);
  const typeWords = [...(options.types ?? []), ...(options.subtypes ?? [])]
    .map(normalizeBulkName)
    .filter(Boolean);

  const rows = await loadSearchRows(db);
  const matches = rows.filter(
    ([name, type]) =>
      words.every(word => name.includes(word)) && typeWords.every(word => type.includes(word)),
  );
  // Whole-word matches first ("elf" -> Arbor Elf before Angelfire), then by name.
  const wordStart = (name: string) =>
    words.every(word => name.startsWith(word) || name.includes(` ${word}`)) ? 0 : 1;
  matches.sort((a, b) => wordStart(a[0]) - wordStart(b[0]) || a[0].localeCompare(b[0]));

  const page = options.page ?? 1;
  const slice = matches.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE);
  const data: CardEntryDetail[] = [];
  for (const [, , key] of slice) {
    const record = await getRecord(db, key).catch(() => undefined);
    if (record?.card) data.push(toDetail(record.card));
  }

  return {
    id: 'scryfall-bulk',
    object: 'list',
    page,
    total_cards: matches.length,
    total_pages: Math.max(1, Math.ceil(matches.length / SEARCH_PAGE_SIZE)),
    data,
  };
}

/** @internal Test hook. */
export function resetBulkIndexStateForTests() {
  ready = undefined;
  building = undefined;
  searchRows = undefined;
}
