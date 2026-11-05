/**
 * Card-data stress test: runs the real deck import + deck-editor search code against a
 * simulated Scryfall and MTG API (no real network, so no risk of getting rate-limited).
 *
 *   npx vite-node --config vitest.integration.config.ts scripts/scryfall-stress/run.ts [scenario...]
 *
 * Model (tunable with env vars):
 *  - Scryfall via our proxy (/api/scryfall): shared server IP, saturated by other users,
 *    so a share of requests get 429 (SIM_PROXY_429, default 0.7).
 *  - Scryfall direct (api.scryfall.com): this user's own quota, ~2 req/s on search/named/
 *    collection and ~10 req/s elsewhere; above that it answers 429 (Retry-After: 1).
 *  - MTG API: 300-600 ms per name lookup, very slow type-only searches.
 */
import { JSDOM } from 'jsdom';
import { gzipSync } from 'node:zlib';

// Optional offline index: FAKE_IDB=<fake-indexeddb/auto entry> SIM_BULK=1
if (process.env.FAKE_IDB) await import(/* @vite-ignore */ process.env.FAKE_IDB);

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://app.test/' });
globalThis.document = dom.window.document;
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
globalThis.Image = dom.window.Image;
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
globalThis.Audio = class {
  play() {
    return Promise.resolve();
  }
  pause() {}
  cloneNode() {
    return new (globalThis.Audio as any)();
  }
} as unknown as typeof Audio;
if (!process.env.SIM_VERBOSE) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
}
const print = (...args: unknown[]) => process.stdout.write(args.join(' ') + '\n');

const PROXY_429 = Number(process.env.SIM_PROXY_429 ?? 0.7);
const DIRECT_BLOCKED = !!process.env.SIM_DIRECT_BLOCKED; // e.g. adblock / firewall
const DIRECT_429 = Number(process.env.SIM_DIRECT_429 ?? 0); // extra random 429s on direct
// Scryfall's docs do not promise Retry-After; a 429 means "limited for 30 s".
const RETRY_AFTER = process.env.SIM_NO_RETRY_AFTER ? undefined : '1';
const WITH_BULK = !!process.env.SIM_BULK;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------- simulated services ----------------
type Stats = Record<string, number>;
const stats: Stats = {};
const bump = (key: string) => (stats[key] = (stats[key] ?? 0) + 1);

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function fakeCard(name: string, set = 'tst', cn = '1') {
  return {
    object: 'card',
    id: `id-${slug(name)}-${set}-${cn}`,
    name,
    set,
    collector_number: cn,
    lang: 'en',
    type_line: 'Creature — Elf',
    oracle_text: 'Text',
    mana_cost: '{G}',
    image_uris: { normal: `https://cards.scryfall.io/normal/${slug(name)}.jpg` },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const tooMany = () =>
  json({ object: 'error', status: 429 }, 429, RETRY_AFTER ? { 'Retry-After': RETRY_AFTER } : {});

function bulkFile() {
  const lines = [];
  for (const prefix of ['Imp', 'Txt', 'Bg']) {
    for (let i = 0; i < 100; i++) lines.push(JSON.stringify(fakeCard(`${prefix} Card ${i}`, 'blk', String(i))));
  }
  for (let i = 0; i < 20; i++) lines.push(JSON.stringify(fakeCard(`Elf Search ${i}`, 'blk', String(i))));
  return gzipSync(lines.join(String.fromCharCode(10)));
}

/** Per-user token buckets for direct calls (strict endpoints 2/s, others 10/s). */
const buckets = { strict: { tokens: 2, at: Date.now() }, other: { tokens: 10, at: Date.now() } };
function takeToken(kind: 'strict' | 'other') {
  const rate = kind === 'strict' ? 2 : 10;
  const bucket = buckets[kind];
  const now = Date.now();
  bucket.tokens = Math.min(rate, bucket.tokens + ((now - bucket.at) / 1000) * rate);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

async function scryfallAnswer(path: string, init?: RequestInit) {
  const url = new URL(path, 'https://api.scryfall.com');
  const p = url.pathname;
  if (p === '/bulk-data/oracle_cards') {
    return json({
      object: 'bulk_data',
      updated_at: '2026-01-01T00:00:00Z',
      jsonl_download_uri: 'https://data.scryfall.io/oracle-cards/sim.jsonl.gz',
    });
  }
  if (p === '/cards/named') {
    await sleep(80);
    const name = url.searchParams.get('exact') ?? url.searchParams.get('fuzzy') ?? '';
    if (name.startsWith('Missing')) return json({ object: 'error', status: 404 }, 404);
    return json(fakeCard(name, url.searchParams.get('set') ?? 'tst'));
  }
  if (p === '/cards/search') {
    await sleep(500);
    const q = url.searchParams.get('q') ?? '';
    const exact = q.match(/^!"(.*)"$/)?.[1];
    if (exact?.startsWith('Missing')) return json({ object: 'error', status: 404 }, 404);
    const data = exact
      ? [fakeCard(exact)]
      : Array.from({ length: 20 }, (_, i) => fakeCard(`Search ${q} ${i}`));
    return json({ object: 'list', total_cards: data.length, data });
  }
  if (p === '/cards/collection') {
    await sleep(800);
    const { identifiers } = JSON.parse(String(init?.body ?? '{}'));
    const data = [];
    const not_found = [];
    for (const id of identifiers) {
      const name = id.name ?? id.id?.replace(/^id-/, '') ?? `Card ${id.set}-${id.collector_number}`;
      if (String(name).startsWith('Missing')) not_found.push(id);
      else data.push(fakeCard(name, id.set ?? 'tst', id.collector_number ?? '1'));
    }
    return json({ object: 'list', data, not_found });
  }
  const parts = p.split('/').filter(Boolean);
  if (parts[0] === 'cards' && parts.length === 3) {
    await sleep(80);
    return json(fakeCard(`Card ${parts[1]}-${parts[2]}`, parts[1], parts[2]));
  }
  if (parts[0] === 'cards' && parts.length === 2) {
    await sleep(80);
    return json(fakeCard(parts[1].replace(/^id-/, '')));
  }
  return json({ object: 'error', status: 404 }, 404);
}

function isStrict(path: string, method: string) {
  return /^\/cards\/(search|named|collection)/.test(new URL(path, 'https://x').pathname) || method === 'POST';
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init?.method ?? 'GET').toUpperCase();

  if (url.startsWith('https://api.magicthegathering.io/')) {
    bump('mtg');
    const params = new URL(url).searchParams;
    await sleep(params.get('name') ? 300 + rand() * 300 : 18_000);
    const name = params.get('name') ?? 'Typed';
    if (name.startsWith('Missing')) return json({ cards: [] });
    return json(
      {
        cards: [
          {
            name,
            type: 'Creature — Elf',
            set: 'TST',
            number: '1',
            imageUrl: 'http://gatherer.wizards.com/x.jpg',
          },
        ],
      },
      200,
      { 'Total-Count': '1', 'Page-Size': '50' },
    );
  }

  if (url.startsWith('https://api.scryfall.com/')) {
    bump('scryfall-direct');
    if (DIRECT_BLOCKED) throw new TypeError('Failed to fetch');
    const path = url.slice('https://api.scryfall.com'.length);
    if (!takeToken(isStrict(path, method) ? 'strict' : 'other') || rand() < DIRECT_429) {
      bump('429-direct');
      await sleep(30);
      return tooMany();
    }
    return scryfallAnswer(path, init);
  }

  if (url.startsWith('/api/scryfall') || url.includes('/api/scryfall/')) {
    bump('scryfall-proxy');
    await sleep(40); // extra hop
    if (rand() < PROXY_429) {
      bump('429-proxy');
      return tooMany();
    }
    const path = url.slice(url.indexOf('/api/scryfall') + '/api/scryfall'.length);
    return scryfallAnswer(path, init);
  }

  if (url.startsWith('https://data.scryfall.io/')) {
    bump('bulk-download');
    return new Response(bulkFile(), { status: 200, headers: { 'Content-Type': 'application/gzip' } });
  }

  if (url.includes('cards.scryfall.io') || url.includes('gatherer')) {
    return new Response(new Blob([new Uint8Array([137, 80, 78, 71])]), { status: 200 });
  }
  if (realFetch) return realFetch(input, init);
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

// ---------------- app code ----------------
const G = await import('../../src/lib/globals');
const { MTG_CARD_SYSTEM } = await import('../../src/lib/mtgCardSystem');
G.setCardSystem(MTG_CARD_SYSTEM);
const { fetchCardInfoForImport } = await import('../../src/lib/deckImportLookup');
const { searchDeckEditorCatalog } = await import('../../src/lib/deckEditorCatalogSearch');
const fallbackModule = await import('../../src/lib/scryfallFallback');
const clientModule = await import('../../src/lib/scryfall/client');
const mtgModule = await import('../../src/lib/mtgApi/client');
const bulkModule = await import('../../src/lib/scryfallBulkIndex');
const catalogModule = await import('../../src/lib/deckEditorCatalogSearch');
if (WITH_BULK) {
  const ok = await bulkModule.ensureBulkIndex();
  print(`offline index built: ${ok}`);
}

function deckEntries(count: number, prefix: string, withPrinting = true) {
  return Array.from({ length: count }, (_, i) => {
    const name = i % 25 === 24 ? `Missing ${prefix} ${i}` : `${prefix} Card ${i}`;
    return withPrinting
      ? { name, qty: 1, set: 'tst', collector_number: String(i + 1), categories: [] }
      : { name, qty: 1, categories: [] };
  });
}

function sourceOf(card: any) {
  if (!card || card.found === false) return 'not-found';
  const url = card.detail?.image_uris?.normal ?? '';
  if (url.includes('gatherer')) return 'mtgapi';
  return card.detail?.set === 'blk' ? 'offline-index' : 'scryfall';
}

function tally(cards: Record<string, any>) {
  const out: Record<string, number> = {};
  for (const card of Object.values(cards)) out[sourceOf(card)] = (out[sourceOf(card)] ?? 0) + 1;
  return out;
}

async function timedSearch(q: string) {
  const t0 = Date.now();
  try {
    const result = await searchDeckEditorCatalog(q, { page: 1 });
    return { ms: Date.now() - t0, source: result.source, n: result.data.length };
  } catch (error) {
    return { ms: Date.now() - t0, source: 'error', n: 0 };
  }
}

function resetWorld() {
  for (const key of Object.keys(stats)) delete stats[key];
  fallbackModule.resetScryfallFallbackForTests?.();
  (clientModule as any).resetScryfallClientForTests?.();
  (mtgModule as any).resetMtgApiStateForTests?.();
  (catalogModule as any).resetDeckEditorCatalogSearchStateForTests?.();
  buckets.strict = { tokens: 2, at: Date.now() };
  buckets.other = { tokens: 10, at: Date.now() };
}

const scenarios: Record<string, () => Promise<Record<string, unknown>>> = {
  /** Moxfield-style import (name + set + collector) of a 100-card deck. */
  async importDeck() {
    resetWorld();
    const t0 = Date.now();
    const cards = await fetchCardInfoForImport(deckEntries(100, 'Imp'));
    return { ms: Date.now() - t0, cards: tally(cards) };
  },

  /** Plain text decklist (names only) — 40 cards. */
  async importNamesOnly() {
    resetWorld();
    const t0 = Date.now();
    const cards = await fetchCardInfoForImport(deckEntries(40, 'Txt', false));
    return { ms: Date.now() - t0, cards: tally(cards) };
  },

  /** User searches "All cards" while a deck is still loading. */
  async searchWhileLoading() {
    resetWorld();
    const load = fetchCardInfoForImport(deckEntries(60, 'Bg', false));
    await sleep(300);
    const searches = [];
    for (const q of ['elf', 'goblin', 'dragon']) {
      searches.push(await timedSearch(q));
      await sleep(400);
    }
    const t0 = Date.now();
    await load;
    return { searches, deckFinishedAfterSearchesMs: Date.now() - t0 };
  },

  /** Typing quickly: 8 searches spaced 800 ms (just above the 750 ms debounce). */
  async rapidSearches() {
    resetWorld();
    const results = [];
    for (const q of ['s', 'so', 'sol', 'sol r', 'sol ri', 'sol rin', 'sol ring', 'sol ring!']) {
      results.push(await timedSearch(q));
      await sleep(800);
    }
    const ms = results.map(r => r.ms);
    const sources: Record<string, number> = {};
    for (const r of results) sources[r.source] = (sources[r.source] ?? 0) + 1;
    return { maxMs: Math.max(...ms), avgMs: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), sources };
  },
};

const selected = process.argv.slice(2).filter(arg => scenarios[arg]);
print(
  `model: proxy 429=${PROXY_429 * 100}%${DIRECT_BLOCKED ? ', direct BLOCKED' : ''}${DIRECT_429 ? `, direct extra 429=${DIRECT_429 * 100}%` : ''}${RETRY_AFTER ? '' : ', no Retry-After'}${WITH_BULK ? ', offline index' : ''}`,
);
for (const name of selected.length ? selected : Object.keys(scenarios)) {
  const started = Date.now();
  const result = await Promise.race([
    scenarios[name](),
    sleep(240_000).then(() => ({ timeout: '>240s' })),
  ]);
  print(`${name}: ${JSON.stringify(result)} requests=${JSON.stringify(stats)} (${Date.now() - started}ms)`);
}
process.exit(0);
