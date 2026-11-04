import { devLog } from './devLog';
import { searchMtgApiCards } from './mtgApi/client';
import {
  searchCards,
  type ScryfallFetchOptions,
  type ScryfallSearchResult,
} from './scryfall/client';

export type DeckCatalogSearchSource = 'scryfall' | 'mtgapi';

export type DeckCatalogSearchResult = ScryfallSearchResult & {
  source: DeckCatalogSearchSource;
};

/** After Scryfall fails or is too slow, prefer MTG API for catalog search for a short window. */
export const SCRYFALL_CATALOG_COOLDOWN_MS = 2 * 60 * 1000;
/** Max wait for a single Scryfall catalog attempt before falling back to MTG API. */
export const SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS = 5_000;

const CATALOG_SCRYFALL_FETCH: ScryfallFetchOptions = {
  maxAttempts: 1,
  requestTimeoutMs: SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS,
};

let scryfallCooldownUntil = 0;

function activateScryfallFallback(reason: string) {
  scryfallCooldownUntil = Date.now() + SCRYFALL_CATALOG_COOLDOWN_MS;
  devLog.warn(`[deck editor] ${reason}; using MTG API fallback`);
}

/** @internal Test hook — resets module cooldown state. */
export function resetDeckEditorCatalogSearchStateForTests() {
  scryfallCooldownUntil = 0;
}

async function searchViaMtgApi(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number },
): Promise<DeckCatalogSearchResult> {
  const result = await searchMtgApiCards(q, options);
  return { ...result, source: 'mtgapi' };
}

function scryfallFallbackReason(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Scryfall catalog search timed out';
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Scryfall catalog search failed (${message})`;
}

/**
 * Catalog search for the deck editor: one fast Scryfall attempt (no 429 retries), then
 * [MTG API](https://docs.magicthegathering.io/) on any failure or after 5s without a response.
 */
export async function searchDeckEditorCatalog(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
): Promise<DeckCatalogSearchResult> {
  const now = Date.now();
  if (now < scryfallCooldownUntil) {
    devLog.log('[deck editor] Scryfall cooldown active; using MTG API for catalog search');
    return searchViaMtgApi(q, options);
  }

  try {
    const result = await searchCards(q, options, CATALOG_SCRYFALL_FETCH);
    return { ...result, source: 'scryfall' };
  } catch (error) {
    activateScryfallFallback(scryfallFallbackReason(error));
    return searchViaMtgApi(q, options);
  }
}
