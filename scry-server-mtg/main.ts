import { cacheMetrics } from './cacheMetrics.ts';
import app, { CACHE_TTL, STALE_TTL } from './server.ts';
import { parseArgs } from 'jsr:@std/cli/parse-args';

app.get('/_cache/stats', c => c.json(cacheMetrics.snapshot()));

const args = parseArgs(Deno.args, { default: { port: 8788 } });
const PORT = Number(args.port);
const kv = await Deno.openKv(Deno.env.get('KV_PATH') || undefined);

type CachedEntry = { body: Uint8Array; headers: Record<string, string>; cachedAt: number };

async function compress(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function decompress(data: Uint8Array): Promise<string> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  return new Response(stream.readable).text();
}

const inflight = new Map<
  string,
  Promise<{ buf: Uint8Array; headers: Record<string, string>; status: number }>
>();

function fetchAndCache(req: Request, key: string[]) {
  const keyStr = key.join(':');
  const existing = inflight.get(keyStr);
  if (existing) return existing;

  const p = (async () => {
    cacheMetrics.fetchedUpstream(); // the one real upstream hit
    const res = await app.fetch(req);
    const buf = new Uint8Array(await res.arrayBuffer());
    const headers = Object.fromEntries(res.headers.entries());
    if (res.ok && headers['content-type']?.includes('application/json')) {
      const compressed = await compress(new TextDecoder().decode(buf));
      await kv.set(
        key,
        { body: compressed, headers, cachedAt: Date.now() },
        { expireIn: (CACHE_TTL + STALE_TTL) * 1000 }, // outlives freshness so stale-serve has a window
      );
      console.log(`KV set: ${key[1]} (${compressed.byteLength}b)`);
    }
    return { buf, headers, status: res.status };
  })();

  inflight.set(keyStr, p);
  p.finally(() => inflight.delete(keyStr));
  return p;
}

async function cachedFetch(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname.startsWith('/_')) {
    return app.fetch(req);
  }

  const key = ['mtg-system-v15', url.pathname + url.search];
  const hit = await kv.get<CachedEntry>(key);

  if (hit.value) {
    cacheMetrics.hit();
    const age = (Date.now() - hit.value.cachedAt) / 1000;
    if (age > CACHE_TTL) {
      console.log(`KV stale: ${key[1]}, refreshing in background`);
      fetchAndCache(req.clone(), key).catch(console.error); // deduped by the same map
    }
    const body = await decompress(hit.value.body);
    return new Response(body, { headers: hit.value.headers });
  }

  cacheMetrics.miss();
  const { buf, headers, status } = await fetchAndCache(req, key);
  return new Response(buf, { status, headers });
}


console.log(`\nDev proxy listening on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, cachedFetch);
