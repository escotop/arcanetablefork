import { Deck, DetailedCardEntry } from './constants';
import { CardPrintingOption, fetchCardPrintings, supportsCardPrintings } from './deck';
import {
  buildPrintingsSearchQuery,
  resolvePrintingsLookup,
  scryfallCardMatchesPrintingsLookup,
} from './deckPrinting';

export function isEntrySpanishPrinting(entry: DetailedCardEntry): boolean {
  return (entry.detail as { lang?: string } | undefined)?.lang === 'es';
}

export async function findSpanishPrintingForEntry(
  entry: DetailedCardEntry,
): Promise<CardPrintingOption | undefined> {
  if (!supportsCardPrintings()) return undefined;
  if (isEntrySpanishPrinting(entry)) return undefined;

  const oracleName = entry.detail?.name ?? entry.name;
  if (!oracleName?.trim()) return undefined;

  const lookup = resolvePrintingsLookup({ name: entry.name, detail: entry.detail });
  const result = await fetchCardPrintings(
    entry.name,
    1,
    buildPrintingsSearchQuery(lookup, 'es'),
    entry.detail,
  );

  const spanish = result.data
    .filter(printing => scryfallCardMatchesPrintingsLookup(printing, lookup))
    .filter(printing => printing.lang === 'es');

  if (!spanish.length) return undefined;

  const preferredSet = entry.set || entry.detail?.set;
  if (preferredSet) {
    const sameSet = spanish.find(
      printing => printing.set?.toLowerCase() === preferredSet.toLowerCase(),
    );
    if (sameSet) return sameSet;
  }

  return spanish[0];
}

export type DeckSectionForSpanish = 'cards' | 'sideboard';

export function listDeckEntriesForSpanishSearch(deck: Deck) {
  const rows: Array<{ section: DeckSectionForSpanish; storageKey: string; entry: DetailedCardEntry }> =
    [];

  for (const section of ['cards', 'sideboard'] as const) {
    for (const [storageKey, entry] of Object.entries(deck[section] ?? {})) {
      if ((entry?.qty ?? 0) > 0) rows.push({ section, storageKey, entry });
    }
  }

  return rows;
}
