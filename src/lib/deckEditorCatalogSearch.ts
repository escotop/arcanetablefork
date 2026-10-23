import { devLog } from './devLog';
import { searchMtgApiCards } from './mtgApi/client';
import { ScryfallRequestError, searchCards, type ScryfallSearchResult } from './scryfall/client';

export type DeckCatalogSearchSource = 'scryfall' | 'mtgapi';

export type DeckCatalogSearchResult = ScryfallSearchResult & {
  source: DeckCatalogSearchSource;
};

/** After Scryfall returns 429, prefer MTG API for catalog search for a short window. */
const SCRYFALL_COOLDOWN_MS = 2 * 60 * 1000;
let scryfallCooldownUntil = 0;

function isScryfallRateLimited(status: number, body: string) {
  if (status === 429 || status === 503) return true;
  const lower = body.toLowerCase();
  return lower.includes('too many requests') || lower.includes('rate limit');
}

/**
 * Catalog search for the deck editor: Scryfall first, [MTG API](https://docs.magicthegathering.io/) on rate limit.
 */
export async function searchDeckEditorCatalog(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number } = {},
): Promise<DeckCatalogSearchResult> {
  const now = Date.now();
  if (now >= scryfallCooldownUntil) {
    try {
      const result = await searchCards(q, options);
      return { ...result, source: 'scryfall' };
    } catch (error) {
      const status = error instanceof ScryfallRequestError ? error.status : 0;
      const body =
        error instanceof ScryfallRequestError
          ? error.body
          : error instanceof Error
            ? error.message
            : '';
      if (!isScryfallRateLimited(status, body)) {
        throw error;
      }
      scryfallCooldownUntil = Date.now() + SCRYFALL_COOLDOWN_MS;
      devLog.warn('[deck editor] Scryfall catalog search rate limited; using MTG API fallback');
    }
  } else {
    devLog.log('[deck editor] Scryfall cooldown active; using MTG API for catalog search');
  }

  const result = await searchMtgApiCards(q, options);
  return { ...result, source: 'mtgapi' };
}
