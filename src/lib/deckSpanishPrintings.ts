import { Deck, DetailedCardEntry } from './constants';
import { CardPrintingOption, fetchCardPrintings, supportsCardPrintings } from './deck';
import {
  buildPrintingsSearchQuery,
  printingsLookupCacheKey,
  resolvePrintingsLookup,
  scryfallCardMatchesPrintingsLookup,
} from './deckPrinting';
import { searchCards } from './scryfall/client';
import { setCachedCardDetail } from './scryfallCache';

const SPANISH_BATCH_CHUNK_SIZE = 15;
const SPANISH_BATCH_CHUNK_DELAY_MS = 120;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isEntrySpanishPrinting(entry: DetailedCardEntry): boolean {
  return (entry.detail as { lang?: string } | undefined)?.lang === 'es';
}

function spanishSearchClause(lookup: ReturnType<typeof resolvePrintingsLookup>): string | undefined {
  if (lookup.oracleId) return `oracle_id:${lookup.oracleId}`;
  const quoted = lookup.scryfallName.replace(/"/g, '\\"');
  if (!quoted) return undefined;
  return `!"${quoted}"`;
}

function searchCardToPrintingOption(card: {
  id?: string;
  name?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  lang?: string;
  released_at?: string;
  image_uris?: CardPrintingOption['image_uris'];
  card_faces?: CardPrintingOption['card_faces'];
}): CardPrintingOption {
  return {
    id: card.id!,
    name: card.name ?? '',
    set: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    lang: card.lang,
    released_at: card.released_at,
    image_uris: card.image_uris,
    card_faces: card.card_faces,
  };
}

export function pickSpanishPrintingOption(
  candidates: CardPrintingOption[],
  lookup: ReturnType<typeof resolvePrintingsLookup>,
  preferredSet?: string,
): CardPrintingOption | undefined {
  const spanish = candidates
    .filter(printing => scryfallCardMatchesPrintingsLookup(printing, lookup))
    .filter(printing => printing.lang === 'es');

  if (!spanish.length) return undefined;

  if (preferredSet) {
    const sameSet = spanish.find(
      printing => printing.set?.toLowerCase() === preferredSet.toLowerCase(),
    );
    if (sameSet) return sameSet;
  }

  return spanish[0];
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

  return pickSpanishPrintingOption(result.data, lookup, entry.set || entry.detail?.set);
}

export type DeckSectionForSpanish = 'cards' | 'sideboard';

export type DeckSpanishSearchRow = {
  section: DeckSectionForSpanish;
  storageKey: string;
  entry: DetailedCardEntry;
};

export function listDeckEntriesForSpanishSearch(deck: Deck): DeckSpanishSearchRow[] {
  const rows: DeckSpanishSearchRow[] = [];

  for (const section of ['cards', 'sideboard'] as const) {
    for (const [storageKey, entry] of Object.entries(deck[section] ?? {})) {
      if ((entry?.qty ?? 0) > 0) rows.push({ section, storageKey, entry });
    }
  }

  return rows;
}

function deckRowKey(section: DeckSectionForSpanish, storageKey: string) {
  return `${section}:${storageKey}`;
}

/** Batch Scryfall search (like import collection) instead of one HTTP call per card. */
export async function findSpanishPrintingsForDeckRows(
  rows: DeckSpanishSearchRow[],
): Promise<Map<string, CardPrintingOption>> {
  const resolved = new Map<string, CardPrintingOption>();
  if (!supportsCardPrintings()) return resolved;

  const pending = rows.filter(row => !isEntrySpanishPrinting(row.entry));
  if (!pending.length) return resolved;

  type LookupGroup = {
    lookupKey: string;
    lookup: ReturnType<typeof resolvePrintingsLookup>;
    clause: string;
    rows: DeckSpanishSearchRow[];
  };

  const groupsByLookup = new Map<string, LookupGroup>();

  for (const row of pending) {
    const lookup = resolvePrintingsLookup({ name: row.entry.name, detail: row.entry.detail });
    const clause = spanishSearchClause(lookup);
    if (!clause) continue;

    const lookupKey = printingsLookupCacheKey({ name: row.entry.name, detail: row.entry.detail });
    const existing = groupsByLookup.get(lookupKey);
    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groupsByLookup.set(lookupKey, {
      lookupKey,
      lookup,
      clause,
      rows: [row],
    });
  }

  const groups = [...groupsByLookup.values()];
  const printingsByLookupKey = new Map<string, CardPrintingOption>();

  for (let index = 0; index < groups.length; index += SPANISH_BATCH_CHUNK_SIZE) {
    const chunk = groups.slice(index, index + SPANISH_BATCH_CHUNK_SIZE);
    const query = `lang:es unique:cards (${chunk.map(group => group.clause).join(' or ')})`;

    try {
      const body = await searchCards(query, { page: 1 });
      await Promise.all(
        body.data.map(card =>
          card.id
            ? setCachedCardDetail(card, {
                id: card.id,
                set: card.set,
                collector_number: card.collector_number,
              })
            : Promise.resolve(),
        ),
      );
      for (const group of chunk) {
        if (printingsByLookupKey.has(group.lookupKey)) continue;

        const candidates = body.data.map(card => searchCardToPrintingOption(card));
        const preferredSet =
          group.rows[0]?.entry.set || group.rows[0]?.entry.detail?.set;
        const picked = pickSpanishPrintingOption(candidates, group.lookup, preferredSet);
        if (picked) {
          printingsByLookupKey.set(group.lookupKey, picked);
        }
      }
    } catch {
      for (const group of chunk) {
        if (printingsByLookupKey.has(group.lookupKey)) continue;
        const entry = group.rows[0]?.entry;
        if (!entry) continue;
        const fallback = await findSpanishPrintingForEntry(entry);
        if (fallback) {
          printingsByLookupKey.set(group.lookupKey, fallback);
        }
      }
    }

    if (index + SPANISH_BATCH_CHUNK_SIZE < groups.length) {
      await delay(SPANISH_BATCH_CHUNK_DELAY_MS);
    }
  }

  for (const group of groups) {
    const printing = printingsByLookupKey.get(group.lookupKey);
    if (!printing) continue;
    for (const row of group.rows) {
      resolved.set(deckRowKey(row.section, row.storageKey), printing);
    }
  }

  return resolved;
}
