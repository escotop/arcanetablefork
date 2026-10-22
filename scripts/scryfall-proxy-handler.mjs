const SCRYFALL_API = 'https://api.scryfall.com';

const SCRYFALL_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'ArcaneTable/1.0 (https://github.com/arcanetable)',
};

const DAY_SECONDS = 24 * 60 * 60;

/**
 * How long a successful Scryfall response may be reused (browser `max-age` and
 * shared-cache `s-maxage`). Card objects addressed by id / set+collector are
 * effectively immutable, name/search lookups may move to newer printings so they
 * get a shorter TTL. Error responses are never cached.
 */
export function scryfallCacheTtlSeconds(pathname, method = 'GET') {
  const path = pathname.replace(/^\/api\/scryfall/, '');
  if (method === 'POST' && /^\/cards\/collection\/?$/.test(path)) return DAY_SECONDS;
  if (method !== 'GET') return 0;
  if (/^\/cards\/(search|named|autocomplete|random)(\/|\?|$)/.test(path)) return DAY_SECONDS;
  // /cards/:id, /cards/:set/:number(/:lang), /cards/:id/rulings, /sets/...
  if (/^\/cards\//.test(path) || /^\/sets(\/|$)/.test(path)) return 7 * DAY_SECONDS;
  return 0;
}

export function scryfallCacheControl(ttlSeconds) {
  if (!ttlSeconds) return 'no-store';
  return `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=${DAY_SECONDS}`;
}

/**
 * Stable cache key for a proxied request. POST /cards/collection is turned into a
 * synthetic GET URL that embeds a hash of the body so edge caches can store it.
 */
export async function scryfallCacheKey(url, method = 'GET', body) {
  const requestUrl = new URL(url, 'http://localhost');
  if (method === 'GET') return requestUrl.toString();
  if (!body) return undefined;
  const digest = await sha256Hex(body);
  return `${requestUrl.origin}${requestUrl.pathname}?__body=${digest}`;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const MEMORY_CACHE_MAX_ENTRIES = 500;
/** @type {Map<string, { expiresAt: number, payload: object }>} */
const memoryCache = new Map();

function readMemoryCache(cacheKey) {
  const hit = memoryCache.get(cacheKey);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memoryCache.delete(cacheKey);
    return undefined;
  }
  return hit.payload;
}

function writeMemoryCache(cacheKey, ttlSeconds, payload) {
  if (!ttlSeconds) return;
  memoryCache.set(cacheKey, { expiresAt: Date.now() + ttlSeconds * 1000, payload });
  while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

export async function handleScryfallProxyRequest({ url, method = 'GET', body }) {
  if (!url) {
    return {
      status: 400,
      body: JSON.stringify({ object: 'error', details: 'missing_path' }),
      contentType: 'application/json',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    };
  }

  const requestUrl = new URL(url, 'http://localhost');
  const pathname = requestUrl.pathname.replace(/^\/api\/scryfall/, '');
  const targetUrl = `${SCRYFALL_API}${pathname}${requestUrl.search || ''}`;

  const normalizedMethod = method.toUpperCase();
  const ttlHint = scryfallCacheTtlSeconds(pathname, normalizedMethod);
  const cacheKey = ttlHint > 0 ? await scryfallCacheKey(url, normalizedMethod, body) : undefined;
  if (cacheKey) {
    const cached = readMemoryCache(cacheKey);
    if (cached) return cached;
  }

  const init = {
    method: normalizedMethod,
    headers: { ...SCRYFALL_HEADERS },
  };

  if (body && normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json';
    init.body = body;
  }

  const response = await fetch(targetUrl, init);
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? 'application/json';

  const ttl = response.ok ? scryfallCacheTtlSeconds(pathname, normalizedMethod) : 0;
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': scryfallCacheControl(ttl),
  };

  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) headers['Retry-After'] = retryAfter;

  const payload = {
    status: response.status,
    body: text,
    contentType,
    headers,
    cacheable: ttl > 0,
  };

  if (cacheKey && ttl > 0 && response.ok) {
    writeMemoryCache(cacheKey, ttl, payload);
  }

  return payload;
}
