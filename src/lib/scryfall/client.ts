import type { CardEntryDetail } from '../constants';
import {
  activateScryfallFallback,
  isScryfallFallbackActive,
} from '../scryfallFallback';

/** Base used for URIs we hand out (all_parts); fetches go through {@link scryfallFetch}. */
const SCRYFALL_API = '/api/scryfall';
const SCRYFALL_DIRECT_ORIGIN = 'https://api.scryfall.com';

/**
 * Scryfall documents hard per-endpoint limits: `/cards/search`, `/cards/named` and
 * `/cards/collection` are capped at 2 req/s (500 ms). Single-card lookups by id or
 * set/collector have no specific documented limit, so they can go a bit faster.
 */
const STRICT_ENDPOINT_INTERVAL_MS = 500;
const DEFAULT_ENDPOINT_INTERVAL_MS = 110;
/** Scryfall: a 429 limits access for 30 s; repeated 429s back off further. */
const RATE_LIMIT_COOLDOWN_MS = 30_000;
const OVERLOAD_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 120_000;
const DIRECT_DISABLED_MS = 10 * 60_000;

export type ScryfallPriority = 'interactive' | 'background';

export interface ScryfallFetchOptions {
  /** Attempts across routes (direct, proxy). Default 2 for interactive, 6 for background. */
  maxAttempts?: number;
  /** Per-attempt network timeout. */
  requestTimeoutMs?: number;
  /** Interactive requests (deck editor search) jump ahead of background hydration. */
  priority?: ScryfallPriority;
  /** Longest we are willing to wait for a rate-limited route to cool down. */
  cooldownBudgetMs?: number;
}

/**
 * Scryfall could not be reached in time (rate limited on every route, timeouts or network
 * errors). Unlike a 404 this says nothing about the card: callers should use a fallback.
 */
export class ScryfallRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Scryfall request failed (${status})`);
    this.name = 'ScryfallRequestError';
    this.status = status;
    this.body = body;
  }
}

export class ScryfallUnavailableError extends ScryfallRequestError {
  constructor(status: number, body: string) {
    super(status, body);
    this.name = 'ScryfallUnavailableError';
    this.message = `Scryfall unavailable (${status || 'network'})`;
  }
}

export function isScryfallUnavailableError(error: unknown): error is ScryfallUnavailableError {
  return error instanceof ScryfallUnavailableError;
}

function isStrictEndpoint(path: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method === 'POST' && /^\/cards\/collection\/?$/.test(path)) return true;
  return /^\/cards\/(search|named|random)(\/|\?|$)/.test(path);
}

function retryAfterMs(response: Response) {
  const header = response.headers.get('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return undefined;
}

const TYPE_ALIASES: Record<string, string> = {
  creature: '(t:creature or t:summon)',
  land: '(t:land)',
  instant: '(t:instant or t:interrupt)',
  artifact: 't:artifact',
  enchantment: 't:enchantment',
  sorcery: 't:sorcery',
  planeswalker: 't:planeswalker',
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Paces request *starts* (not completions) at a fixed interval, highest priority first.
 * Slow responses no longer block every other request behind them.
 */
class RateGate {
  private waiting: Array<{ priority: number; seq: number; resolve: () => void }> = [];
  private nextAt = 0;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly intervalMs: number) {}

  acquire(priority: number): Promise<void> {
    return new Promise(resolve => {
      this.waiting.push({ priority, seq: this.seq++, resolve });
      this.waiting.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      this.pump();
    });
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.nextAt = 0;
    this.waiting.splice(0).forEach(entry => entry.resolve());
  }

  private pump() {
    if (this.timer || !this.waiting.length) return;
    const wait = this.nextAt - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    const next = this.waiting.shift()!;
    this.nextAt = Date.now() + this.intervalMs;
    next.resolve();
    this.pump();
  }
}

type RouteName = 'direct' | 'proxy';

interface RouteState {
  base: string;
  /** Rate limited until then (Retry-After or exponential backoff). */
  cooldownUntil: number;
  consecutiveLimited: number;
  /** Network/CORS failures (ad blockers, firewalls): skip this route for a while. */
  disabledUntil: number;
  gates: { strict: RateGate; other: RateGate };
}

function createRoute(base: string): RouteState {
  return {
    base,
    cooldownUntil: 0,
    consecutiveLimited: 0,
    disabledUntil: 0,
    gates: {
      strict: new RateGate(STRICT_ENDPOINT_INTERVAL_MS),
      other: new RateGate(DEFAULT_ENDPOINT_INTERVAL_MS),
    },
  };
}

/**
 * Two independent ways to reach Scryfall. Direct calls (CORS is allowed) use each player's
 * own rate limit; our proxy shares one server IP with every other player, which is where
 * most 429s came from. The proxy stays as second route (and has an edge cache).
 */
const routes: Record<RouteName, RouteState> = {
  direct: createRoute(SCRYFALL_DIRECT_ORIGIN),
  proxy: createRoute(SCRYFALL_API),
};
const ROUTE_ORDER: RouteName[] = ['direct', 'proxy'];

function routeAvailableAt(route: RouteState) {
  return Math.max(route.cooldownUntil, route.disabledUntil);
}

function pickRoute(budgetEnd: number): { name: RouteName; waitMs: number } | undefined {
  const now = Date.now();
  let best: { name: RouteName; at: number } | undefined;
  for (const name of ROUTE_ORDER) {
    const route = routes[name];
    if (route.disabledUntil > now) continue;
    const at = Math.max(now, route.cooldownUntil);
    if (at === now) return { name, waitMs: 0 };
    if (!best || at < best.at) best = { name, at };
  }
  if (!best || best.at > budgetEnd) return undefined;
  return { name: best.name, waitMs: best.at - now };
}

function noteLimited(route: RouteState, response: Response) {
  const header = retryAfterMs(response);
  const base = response.status === 503 ? OVERLOAD_COOLDOWN_MS : RATE_LIMIT_COOLDOWN_MS;
  const backoff = base * 2 ** route.consecutiveLimited;
  route.consecutiveLimited++;
  // Never call a limited route again before Scryfall allows it: hammering extends the block.
  route.cooldownUntil = Date.now() + Math.min(MAX_COOLDOWN_MS, header ?? backoff);
}

function noteOk(route: RouteState) {
  route.consecutiveLimited = 0;
}

/** When every route is down, tell the rest of the app to use fallbacks until one recovers. */
function signalUnavailable(source: string, reason: string) {
  const now = Date.now();
  const recoverAt = Math.min(...ROUTE_ORDER.map(name => routeAvailableAt(routes[name])));
  if (recoverAt <= now) return;
  activateScryfallFallback(source, reason, recoverAt - now);
}

/** Relative Scryfall API path for any accepted form, or null for a non-Scryfall URL. */
function toScryfallPath(path: string): string | null {
  if (path.startsWith(SCRYFALL_DIRECT_ORIGIN)) return path.slice(SCRYFALL_DIRECT_ORIGIN.length) || '/';
  const proxyIndex = path.indexOf(SCRYFALL_API);
  if (path.startsWith(SCRYFALL_API)) return path.slice(SCRYFALL_API.length) || '/';
  if (path.startsWith('http')) {
    if (proxyIndex >= 0) return path.slice(proxyIndex + SCRYFALL_API.length) || '/';
    return null;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Every Scryfall request goes through here: per-endpoint pacing, route failover on 429/503,
 * bounded waits. Returns the response for any status except "rate limited everywhere",
 * which throws {@link ScryfallUnavailableError}.
 */
export async function scryfallFetch(
  path: string,
  init?: RequestInit,
  options?: ScryfallFetchOptions,
): Promise<Response> {
  const interactive = options?.priority === 'interactive';
  const timeoutMs = options?.requestTimeoutMs ?? (interactive ? 5_000 : 20_000);
  const relativePath = toScryfallPath(path);
  if (relativePath === null) return fetchWithTimeout(path, init, timeoutMs);

  const gateKind = isStrictEndpoint(relativePath.split('?')[0], init) ? 'strict' : 'other';
  const maxAttempts = options?.maxAttempts ?? (interactive ? 2 : 6);
  const budgetEnd = Date.now() + (options?.cooldownBudgetMs ?? (interactive ? 1_500 : 12_000));
  const priority = interactive ? 1 : 0;

  let lastResponse: Response | undefined;
  let lastError: unknown;
  let attempts = 0;
  let reroutes = 0;

  while (attempts < maxAttempts) {
    const choice = pickRoute(budgetEnd);
    if (!choice) break;
    if (choice.waitMs > 0) await delay(choice.waitMs);

    const route = routes[choice.name];
    await route.gates[gateKind].acquire(priority);
    // Another request may have hit a 429 on this route while we waited for our slot.
    if (routeAvailableAt(route) > Date.now() && reroutes < 4) {
      reroutes++;
      continue;
    }

    attempts++;
    try {
      const response = await fetchWithTimeout(`${route.base}${relativePath}`, init, timeoutMs);
      if (response.status === 429 || response.status === 503) {
        noteLimited(route, response);
        lastResponse = response;
        continue;
      }
      if (response.status >= 500 && attempts < maxAttempts) {
        // Upstream hiccup on this route: give it a short break and try the other one.
        route.cooldownUntil = Date.now() + 2_000;
        lastResponse = response;
        continue;
      }
      noteOk(route);
      return response;
    } catch (error) {
      lastError = error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) {
        route.cooldownUntil = Date.now() + 3_000;
      } else if (choice.name === 'direct') {
        // Blocked by an extension/firewall/CORS: stop trying direct for a while.
        route.disabledUntil = Date.now() + DIRECT_DISABLED_MS;
      } else {
        route.cooldownUntil = Date.now() + 5_000;
      }
    }
  }

  const status = lastResponse?.status ?? 0;
  const body = lastResponse
    ? await lastResponse.text().catch(() => '')
    : String(lastError instanceof Error ? lastError.message : lastError ?? 'unavailable');
  signalUnavailable(relativePath.split('?')[0], `HTTP ${status || 'network error'}`);
  throw new ScryfallUnavailableError(status, body);
}

/** @internal Test hook. */
export function resetScryfallClientForTests() {
  for (const name of ROUTE_ORDER) {
    const route = routes[name];
    route.cooldownUntil = 0;
    route.consecutiveLimited = 0;
    route.disabledUntil = 0;
    route.gates.strict.reset();
    route.gates.other.reset();
  }
}

/** Debug view of route health (devtools / bug logs). */
export function getScryfallRouteStatus() {
  const now = Date.now();
  return Object.fromEntries(
    ROUTE_ORDER.map(name => [
      name,
      {
        coolingMs: Math.max(0, routes[name].cooldownUntil - now),
        disabledMs: Math.max(0, routes[name].disabledUntil - now),
        consecutiveLimited: routes[name].consecutiveLimited,
      },
    ]),
  );
}

/**
 * Image URL on cards.scryfall.io for a Scryfall card id. That host has no rate limit, unlike
 * `api.scryfall.com/cards/:id?format=image`, which counts against the API limit for every
 * <img> on screen (a list of decks could trigger 429s on its own).
 */
export function scryfallImageUrlFromId(
  id: string,
  version: 'small' | 'normal' | 'large' | 'png' | 'art_crop' | 'border_crop' = 'normal',
  face: 'front' | 'back' = 'front',
) {
  const clean = id.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(clean)) return undefined;
  const ext = version === 'png' ? 'png' : 'jpg';
  return `https://cards.scryfall.io/${version}/${face}/${clean[0]}/${clean[1]}/${clean}.${ext}`;
}

export function mapScryfallCard(card: Record<string, unknown>): CardEntryDetail {
  const popularity =
    typeof card.edhrec_rank === 'number'
      ? card.edhrec_rank
      : typeof card.edhrec_rank === 'string'
        ? Number(card.edhrec_rank)
        : 99999;

  return {
    ...(card as CardEntryDetail),
    id: String(card.id ?? ''),
    name: String(card.name ?? ''),
    set: card.set as string | undefined,
    collector_number: card.collector_number as string | undefined,
    lang: card.lang as string | undefined,
    type_line: String(card.type_line ?? ''),
    image_uris: (card.image_uris as Record<string, string>) ?? {},
    card_faces: (card.card_faces as CardEntryDetail['card_faces']) ?? undefined,
    all_parts: (card.all_parts as CardEntryDetail['all_parts'])?.map(part => ({
      ...part,
      uri: part.uri ?? `${SCRYFALL_API}/cards/${part.id}`,
    })),
    popularity,
    search: '',
  };
}

async function readCard(response: Response): Promise<CardEntryDetail | null> {
  if (!response.ok) return null;
  const card = await response.json();
  if (card?.object === 'error') return null;
  return mapScryfallCard(card);
}

/** null = Scryfall has no such card; throws {@link ScryfallUnavailableError} when unreachable. */
export async function lookupCardById(
  id: string,
  options?: ScryfallFetchOptions,
): Promise<CardEntryDetail | null> {
  return readCard(await scryfallFetch(`/cards/${encodeURIComponent(id)}`, undefined, options));
}

export async function lookupCardNamed(
  exact: string,
  lookup: { set?: string; id?: string } = {},
  options?: ScryfallFetchOptions,
): Promise<CardEntryDetail | null> {
  if (lookup.id) return lookupCardById(lookup.id, options);
  const params = new URLSearchParams({ exact });
  if (lookup.set) params.set('set', lookup.set);
  return readCard(await scryfallFetch(`/cards/named?${params}`, undefined, options));
}

export async function lookupCardBySetCollector(
  set: string,
  collectorNumber: string,
  options?: ScryfallFetchOptions,
): Promise<CardEntryDetail | null> {
  return readCard(
    await scryfallFetch(
      `/cards/${encodeURIComponent(set)}/${encodeURIComponent(collectorNumber)}`,
      undefined,
      options,
    ),
  );
}

async function nullWhenUnavailable<T>(lookup: Promise<T | null>): Promise<T | null> {
  try {
    return await lookup;
  } catch (error) {
    if (isScryfallUnavailableError(error)) return null;
    throw error;
  }
}

export async function getCardById(id: string): Promise<CardEntryDetail | null> {
  return nullWhenUnavailable(lookupCardById(id));
}

export async function getCardNamed(
  exact: string,
  options: { set?: string; id?: string } = {},
): Promise<CardEntryDetail | null> {
  return nullWhenUnavailable(lookupCardNamed(exact, options));
}

export async function getCardBySetCollector(
  set: string,
  collectorNumber: string,
): Promise<CardEntryDetail | null> {
  return nullWhenUnavailable(lookupCardBySetCollector(set, collectorNumber));
}

export interface ScryfallSearchResult {
  id: string;
  object: 'list';
  page: number;
  total_cards: number;
  total_pages: number;
  data: CardEntryDetail[];
}

function formatSubtypeQuery(subtype: string) {
  const trimmed = subtype.trim();
  if (/^[a-z0-9]+$/i.test(trimmed)) {
    return `t:${trimmed}`;
  }
  return `t:"${trimmed.replace(/"/g, '\\"')}"`;
}

function buildSearchQuery(q: string, types: string[] = [], subtypes: string[] = []) {
  const parts: string[] = [];
  if (q?.trim()) parts.push(q.trim());
  if (types.length) {
    let typeQuery = types.map(t => TYPE_ALIASES[t.toLowerCase()] ?? `t:${t}`).join(' or ');
    if (types.length > 1) typeQuery = `(${typeQuery})`;
    parts.push(typeQuery);
  }
  for (const subtype of subtypes) {
    if (subtype.trim()) parts.push(formatSubtypeQuery(subtype));
  }
  return parts.join(' ').trim() || '*';
}

export async function searchCards(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
  fetchOptions?: ScryfallFetchOptions,
): Promise<ScryfallSearchResult> {
  const page = options.page ?? 1;
  const params = new URLSearchParams({
    q: buildSearchQuery(q, options.types, options.subtypes),
    order: 'name',
    page: String(page),
  });

  const res = await scryfallFetch(`/cards/search?${params}`, undefined, fetchOptions);
  const text = await res.text();
  if (res.status === 404) {
    return { id: 'mtgplayer', object: 'list', page, total_cards: 0, total_pages: 0, data: [] };
  }
  if (!res.ok) {
    throw new ScryfallRequestError(res.status, text);
  }

  const list = JSON.parse(text) as {
    total_cards?: number;
    data?: Array<Record<string, unknown>>;
  };
  const totalCards = list.total_cards ?? list.data?.length ?? 0;
  return {
    id: 'mtgplayer',
    object: 'list',
    page,
    total_cards: totalCards,
    total_pages: Math.max(1, Math.ceil(totalCards / 175)),
    data: (list.data ?? []).map((card: Record<string, unknown>) => mapScryfallCard(card)),
  };
}

export const SCRYFALL_COLLECTION_MAX_IDENTIFIERS = 75;

export type ScryfallCollectionIdentifier =
  | { id: string }
  | { name: string }
  | { name: string; set: string }
  | { set: string; collector_number: string };

export interface ScryfallCollectionResponse {
  object?: string;
  data?: Array<Record<string, unknown>>;
  not_found?: ScryfallCollectionIdentifier[];
}

export async function postCardCollection(
  identifiers: ScryfallCollectionIdentifier[],
  options?: ScryfallFetchOptions,
): Promise<ScryfallCollectionResponse> {
  if (identifiers.length > SCRYFALL_COLLECTION_MAX_IDENTIFIERS) {
    throw new Error(
      `Scryfall collection accepts at most ${SCRYFALL_COLLECTION_MAX_IDENTIFIERS} identifiers`,
    );
  }

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers }),
  };

  // Rate limits and route failover are handled by scryfallFetch (throws when unavailable).
  const res = await scryfallFetch('/cards/collection', init, options);
  const text = await res.text();
  if (res.ok) {
    return JSON.parse(text) as ScryfallCollectionResponse;
  }
  throw new ScryfallRequestError(res.status, text);
}

/** Like {@link postCardCollection} but returns null instead of throwing (deck tokens, import batches). */
export async function tryPostCardCollection(
  identifiers: ScryfallCollectionIdentifier[],
): Promise<ScryfallCollectionResponse | null> {
  if (isScryfallFallbackActive()) return null;
  try {
    return await postCardCollection(identifiers);
  } catch {
    return null;
  }
}

/**
 * Fetch many cards by Scryfall id using `/cards/collection` in chunks of 75.
 * Returns raw card objects; ids that Scryfall does not know are simply absent.
 */
export async function fetchCardsByIds(ids: string[]): Promise<Array<Record<string, unknown>>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const cards: Array<Record<string, unknown>> = [];
  for (let index = 0; index < unique.length; index += SCRYFALL_COLLECTION_MAX_IDENTIFIERS) {
    const batch = unique.slice(index, index + SCRYFALL_COLLECTION_MAX_IDENTIFIERS);
    const body = await postCardCollection(batch.map(id => ({ id })));
    cards.push(...(body.data ?? []));
  }
  return cards;
}
