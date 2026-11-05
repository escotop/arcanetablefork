/**
 * End-to-end check of the offline Scryfall index (real bulk download, fake IndexedDB).
 *   FAKE_IDB=<path to fake-indexeddb/auto/index.mjs> npx vite-node --config vitest.integration.config.ts scripts/scryfall-stress/bulk-index-check.ts
 */
const fakeIdb = process.env.FAKE_IDB;
if (!fakeIdb) throw new Error('set FAKE_IDB to fake-indexeddb/auto entry');
await import(/* @vite-ignore */ fakeIdb);

// Browsers send their own User-Agent; Node's default one is rejected by Scryfall.
const nodeFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', 'ArcaneTable-dev-check/1.0');
  return nodeFetch(input, { ...init, headers });
}) as typeof fetch;

const bulk = await import('../../src/lib/scryfallBulkIndex');
const memBefore = process.memoryUsage().heapUsed;
const t0 = performance.now();
const ok = await bulk.ensureBulkIndex();
const buildMs = Math.round(performance.now() - t0);
const memAfter = process.memoryUsage().heapUsed;
console.log(`build ok=${ok} in ${buildMs} ms, heap +${Math.round((memAfter - memBefore) / 1e6)} MB`);

for (const name of ['Sol Ring', "Lim-Dul's Vault", 'Delver of Secrets', 'Fire // Ice', 'Treasure', 'Not A Real Card']) {
  const t = performance.now();
  const card = await bulk.lookupBulkCard(name);
  console.log(
    `lookup ${JSON.stringify(name)} -> ${card ? `${card.name} [${card.set} #${card.collector_number}] img=${!!(card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal)}` : 'null'} (${Math.round(performance.now() - t)} ms)`,
  );
}

for (const [q, types] of [['elf', ['creature']], ['bolt', []], ['', ['planeswalker']]] as const) {
  const t = performance.now();
  const result = await bulk.searchBulkCards(q, { types: [...types] });
  console.log(
    `search ${JSON.stringify(q)} ${JSON.stringify(types)} -> total=${result?.total_cards} first=${result?.data.slice(0, 3).map(c => c.name).join(', ')} (${Math.round(performance.now() - t)} ms)`,
  );
}

// Second call must reuse the stored index (no re-download).
const t1 = performance.now();
await bulk.ensureBulkIndex();
console.log(`refresh with same updated_at: ${Math.round(performance.now() - t1)} ms`);
process.exit(0);
