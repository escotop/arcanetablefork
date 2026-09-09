import { CardEntry, CardEntryDetail, DetailedCardEntry } from './constants';

type CardDetailWithOracle = CardEntryDetail & { oracle_id?: string; id?: string };

export function getCardKey(entry: CardEntry) {
  return entry?.id ?? [entry.name, entry.set].join(':');
}

function getEntryOracleId(entry: CardEntry | DetailedCardEntry) {
  const detail = (entry as DetailedCardEntry).detail as CardDetailWithOracle | undefined;
  return detail?.oracle_id;
}

function normalizeDeckCardName(name: string | undefined) {
  return (name ?? '').trim().toLowerCase();
}

/** Match a catalog/search card to an existing deck entry across printings. */
export function findDeckEntryMatch(
  catalogCard: DetailedCardEntry,
  deckCards: Record<string, DetailedCardEntry>,
): { key: string; entry: DetailedCardEntry } | undefined {
  const exactKey = getCardKey(catalogCard);
  const exact = deckCards[exactKey];
  if (exact?.qty > 0) return { key: exactKey, entry: exact };

  const catalogOracleId = getEntryOracleId(catalogCard);
  if (catalogOracleId) {
    for (const [key, entry] of Object.entries(deckCards)) {
      if (!entry?.qty) continue;
      if (getEntryOracleId(entry) === catalogOracleId) {
        return { key, entry };
      }
    }
  }

  const catalogName = normalizeDeckCardName(catalogCard.name ?? catalogCard.detail?.name);
  if (!catalogName) return undefined;

  for (const [key, entry] of Object.entries(deckCards)) {
    if (!entry?.qty) continue;
    if (normalizeDeckCardName(entry.name ?? entry.detail?.name) === catalogName) {
      return { key, entry };
    }
  }

  return undefined;
}
