import { devLog } from './devLog';
import { isMtgApiAvailable, searchMtgApiCards } from './mtgApi/client';
import { scheduleBulkIndexRefresh, searchBulkCards } from './scryfallBulkIndex';
import {
  activateScryfallFallback,
  isScryfallFallbackActive,
  resetScryfallFallbackForTests,
} from './scryfallFallback';
import {
  isScryfallUnavailableError,
  ScryfallRequestError,
  searchCards,
  type ScryfallFetchOptions,
  type ScryfallSearchResult,
} from './scryfall/client';

export type DeckCatalogSearchSource = 'scryfall' | 'scryfall-offline' | 'mtgapi';

export type DeckCatalogSearchResult = ScryfallSearchResult & {
  source: DeckCatalogSearchSource;
};

/** Max wait for a single Scryfall catalog attempt before using a fallback. */
export const SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS = 5_000;

/** Interactive: ahead of background deck hydration, tries both routes, never waits long. */
const CATALOG_SCRYFALL_FETCH: ScryfallFetchOptions = {
  priority: 'interactive',
  requestTimeoutMs: SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS,
};

const RESULT_CACHE_TTL_MS = 10 * 60_000;
const RESULT_CACHE_MAX = 60;
const resultCache = new Map<string, { at: number; result: DeckCatalogSearchResult }>();

type SearchOptions = { types?: string[]; subtypes?: string[]; page?: number };

function cacheKey(q: string, options: SearchOptions) {
  return JSON.stringify([
    q.trim().toLowerCase(),
    [...(options.types ?? [])].sort(),
    [...(options.subtypes ?? [])].sort(),
    options.page ?? 1,
  ]);
}

function readCache(key: string) {
  const hit = resultCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > RESULT_CACHE_TTL_MS) {
    resultCache.delete(key);
    return undefined;
  }
  return hit.result;
}

function writeCache(key: string, result: DeckCatalogSearchResult) {
  // Only real Scryfall answers: fallback results should be replaced as soon as possible.
  if (result.source !== 'scryfall') return;
  resultCache.delete(key);
  resultCache.set(key, { at: Date.now(), result });
  while (resultCache.size > RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
}

function catalogFallbackReason(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Scryfall catalog search timed out';
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Scryfall catalog search failed (${message})`;
}

/** @internal Test hook — resets module cooldown state. */
export function resetDeckEditorCatalogSearchStateForTests() {
  resetScryfallFallbackForTests();
  resultCache.clear();
}

/** Scryfall unreachable: local Scryfall index (same data) first, MTG API as last resort. */
async function searchViaFallback(q: string, options: SearchOptions): Promise<DeckCatalogSearchResult> {
  const offline = await searchBulkCards(q, options).catch(() => null);
  if (offline) return { ...offline, source: 'scryfall-offline' };
  if (!isMtgApiAvailable()) {
    throw new Error('Card search is temporarily unavailable');
  }
  const result = await searchMtgApiCards(q, options);
  return { ...result, source: 'mtgapi' };
}

/**
 * Catalog search for the deck editor: Scryfall first (interactive priority, both routes),
 * then the offline index / MTG API while Scryfall is unavailable.
 */
export async function searchDeckEditorCatalog(
  q: string,
  options: SearchOptions = {},
): Promise<DeckCatalogSearchResult> {
  const key = cacheKey(q, options);
  const cached = readCache(key);
  if (cached) return cached;

  if (isScryfallFallbackActive()) {
    devLog.log('[deck editor] Scryfall unavailable; using fallback catalog search');
    return searchViaFallback(q, options);
  }

  try {
    const result: DeckCatalogSearchResult = {
      ...(await searchCards(q, options, CATALOG_SCRYFALL_FETCH)),
      source: 'scryfall',
    };
    writeCache(key, result);
    return result;
  } catch (error) {
    const unavailable = isScryfallUnavailableError(error);
    const status = error instanceof ScryfallRequestError ? error.status : undefined;
    // Invalid query syntax: Scryfall is fine, there are just no results to show.
    if (!unavailable && (status === 400 || status === 422)) {
      return {
        id: 'mtgplayer',
        object: 'list',
        page: options.page ?? 1,
        total_cards: 0,
        total_pages: 0,
        data: [],
        source: 'scryfall',
      };
    }
    if (!unavailable) {
      activateScryfallFallback('catalog search', catalogFallbackReason(error));
    }
    return searchViaFallback(q, options);
  }
}

// Players who needed the offline index before get it refreshed in the background.
setTimeout(() => void scheduleBulkIndexRefresh().catch(() => {}), 5_000);
