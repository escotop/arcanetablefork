import { devLog } from './devLog';
import { searchMtgApiCards } from './mtgApi/client';
import { searchCards, type ScryfallSearchResult } from './scryfall/client';

export type DeckCatalogSearchSource = 'scryfall' | 'mtgapi';

export type DeckCatalogSearchResult = ScryfallSearchResult & {
  source: DeckCatalogSearchSource;
};

/** After Scryfall fails or is too slow, prefer MTG API for catalog search for a short window. */
export const SCRYFALL_CATALOG_COOLDOWN_MS = 2 * 60 * 1000;
/** If Scryfall has not finished by then, use MTG API for this search (and start cooldown). */
export const SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS = 5_000;

let scryfallCooldownUntil = 0;

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function activateScryfallFallback(reason: string) {
  scryfallCooldownUntil = Date.now() + SCRYFALL_CATALOG_COOLDOWN_MS;
  devLog.warn(`[deck editor] ${reason}; using MTG API fallback`);
}

/** @internal Test hook — resets module cooldown state. */
export function resetDeckEditorCatalogSearchStateForTests() {
  scryfallCooldownUntil = 0;
}

type ScryfallRaceResult =
  | { kind: 'ok'; result: ScryfallSearchResult }
  | { kind: 'error'; error: unknown };

async function raceScryfallCatalogSearch(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number },
): Promise<ScryfallRaceResult> {
  const scryfallAttempt = searchCards(q, options)
    .then(result => ({ kind: 'ok' as const, result }))
    .catch(error => ({ kind: 'error' as const, error }));

  const slowThreshold = delay(SCRYFALL_CATALOG_FALLBACK_TIMEOUT_MS).then(() => ({
    kind: 'slow' as const,
  }));

  const first = await Promise.race([scryfallAttempt, slowThreshold]);

  if (first.kind === 'slow') {
    return { kind: 'error', error: new Error('Scryfall catalog search timed out') };
  }

  return first;
}

async function searchViaMtgApi(
  q: string,
  options: { types?: string[]; subtypes?: string[]; page?: number },
): Promise<DeckCatalogSearchResult> {
  const result = await searchMtgApiCards(q, options);
  return { ...result, source: 'mtgapi' };
}

/**
 * Catalog search for the deck editor: Scryfall first, [MTG API](https://docs.magicthegathering.io/)
 * on any Scryfall failure or if Scryfall has not responded within 5 seconds.
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

  const raced = await raceScryfallCatalogSearch(q, options);

  if (raced.kind === 'ok') {
    return { ...raced.result, source: 'scryfall' };
  }

  const error = raced.error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('timed out')) {
    activateScryfallFallback('Scryfall catalog search exceeded 5s');
  } else {
    activateScryfallFallback(`Scryfall catalog search failed (${message})`);
  }

  return searchViaMtgApi(q, options);
}
