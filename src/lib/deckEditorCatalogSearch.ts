import { devLog } from './devLog';
import { searchMtgApiCards } from './mtgApi/client';
import {
  activateScryfallFallback,
  isScryfallFallbackActive,
  resetScryfallFallbackForTests,
} from './scryfallFallback';
import {
  searchCards,
  type ScryfallFetchOptions,
  type ScryfallSearchResult,
} from './scryfall/client';

export type DeckCatalogSearchSource = 'scryfall' | 'mtgapi';

export type DeckCatalogSearchResult = ScryfallSearchResult & {
  source: DeckCatalogSearchSource;
};

/** Max wait for a single Scryfall catalog attempt before falling back to MTG API. */
export const SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS = 5_000;

const CATALOG_SCRYFALL_FETCH: ScryfallFetchOptions = {
  maxAttempts: 1,
  requestTimeoutMs: SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS,
};

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
}

async function searchViaMtgApi(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number },
): Promise<DeckCatalogSearchResult> {
  const result = await searchMtgApiCards(q, options);
  return { ...result, source: 'mtgapi' };
}

/**
 * Catalog search for the deck editor: one fast Scryfall attempt, then MTG API on failure.
 * Shares the global 5-minute Scryfall fallback window with deck hydration.
 */
export async function searchDeckEditorCatalog(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
): Promise<DeckCatalogSearchResult> {
  if (isScryfallFallbackActive()) {
    devLog.log('[deck editor] Scryfall fallback active; using MTG API for catalog search');
    return searchViaMtgApi(q, options);
  }

  try {
    const result = await searchCards(q, options, CATALOG_SCRYFALL_FETCH);
    return { ...result, source: 'scryfall' };
  } catch (error) {
    activateScryfallFallback('catalog search', catalogFallbackReason(error));
    return searchViaMtgApi(q, options);
  }
}
