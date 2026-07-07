// VERSION: 1.0
import { Hono } from 'hono';
import { CACHE_TTL, STALE_TTL } from './server.ts';

export const kv = await Deno.openKv(Deno.env.get('KV_PATH') || undefined);

let hits = 0;
let misses = 0;
let upstreamFetches = 0;

export const cacheMetrics = {
  hit: () => void hits++,
  miss: () => void misses++,
  fetchedUpstream: () => void upstreamFetches++,
  snapshot() {
    const total = hits + misses;
    return { hits, misses, total, hitRate: total ? hits / total : 0, upstreamFetches };
  },
};

export async function compress(buffer: ArrayBuffer): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(buffer);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export async function decompress(data: BufferSource) {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  return stream.readable;
}

export async function handleRequest(app: Hono, req: Request, key: string[]): Promise<Response> {
  cacheMetrics.fetchedUpstream();
  const res = await app.fetch(req);

  const headers = Object.fromEntries(res.headers.entries());
  if (res.ok && headers['content-type']?.includes('application/json')) {
    const buffer = await res.arrayBuffer();
    const compressed = await compress(buffer.slice());
    await kv.set(
      key,
      { body: compressed, headers, cachedAt: Date.now() },
      { expireIn: (CACHE_TTL + STALE_TTL) * 1000 },
    );
    console.log(`[cache set] ${key[1]} (${compressed.byteLength}b)`);
    return new Response(buffer, { headers, status: res.status });
  } else {
    const r = res.clone();
    console.log('[error]', r.status, await r.text(), r.url)
  }
  return res;
}

type CachedEntry = { body: Uint8Array; headers: Record<string, string>; cachedAt: number };

const inflight = new Map<string, Promise<Response>>();

export function fetchAndCache(app: Hono, req: Request, key: string[]) {
  const keyStr = key.join(':');
  const existing = inflight.get(keyStr);
  if (existing) return existing;

  const promise = handleRequest(app, req, key);

  inflight.set(keyStr, promise);
  promise.finally(() => inflight.delete(keyStr));
  return promise;
}

export function withCaching(app: Hono, cacheKeyPrefix: string) {
  return async function cachedFetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const localURL = url.pathname + url.search;
    const key = [cacheKeyPrefix, localURL];

    if (url.pathname.startsWith('/_') || url.pathname === '/') {
      console.log('[request]', localURL);
      return app.fetch(req);
    }

    const hit = await kv.get<CachedEntry>(key);

    if (hit.value) {
      cacheMetrics.hit();
      const age = (Date.now() - hit.value.cachedAt) / 1000;
      if (age > CACHE_TTL) {
        console.log(`[cache stale] ${localURL}, refreshing in background`);
        fetchAndCache(app, req.clone(), key).catch(console.error);
      }
      const stream = await decompress(hit.value.body);

      console.log('[cache hit]', localURL);
      return new Response(stream, { headers: hit.value.headers, status: hit.value.status });
    }

    cacheMetrics.miss();
    console.log('[cache miss]', localURL);
    return await fetchAndCache(app, req, key);
  };
}
