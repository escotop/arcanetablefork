import { CardEntry, CardEntryDetail } from './constants';

export type PrintingsLookupSource = { name?: string; detail?: CardEntryDetail };

type ScryfallPrintingCandidate = {
  name?: string;
  oracle_id?: string;
  card_faces?: Array<{ name?: string }>;
};

/** Deck lists often use "Face A / Face B"; Scryfall uses "Face A // Face B". */
export function normalizeDoubleFacedCardName(name?: string | null): string {
  if (name == null) return '';
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(' // ')) return trimmed;
  const parts = trimmed.split(/\s+\/\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.join(' // ');
  return trimmed;
}

export function resolvePrintingsLookupName(source: PrintingsLookupSource): string {
  const detail = source.detail;
  if (detail?.name) return normalizeDoubleFacedCardName(detail.name);

  const faces = detail?.card_faces;
  if (faces && faces.length >= 2) {
    const front = faces[0]?.name?.trim();
    const back = faces[1]?.name?.trim();
    if (front && back) return `${front} // ${back}`;
  }

  return normalizeDoubleFacedCardName(source.name ?? detail?.name ?? '');
}

export function resolvePrintingsLookup(source: PrintingsLookupSource) {
  const detail = source.detail as (CardEntryDetail & { oracle_id?: string }) | undefined;
  const deckName = source.name ?? detail?.name ?? '';
  return {
    deckName,
    scryfallName: resolvePrintingsLookupName({ name: deckName, detail }),
    oracleId: detail?.oracle_id,
  };
}

export function printingsLookupCacheKey(source: PrintingsLookupSource): string {
  const lookup = resolvePrintingsLookup(source);
  return lookup.oracleId ?? lookup.scryfallName;
}

export function scryfallCardMatchesPrintingsLookup(
  card: ScryfallPrintingCandidate,
  lookup: ReturnType<typeof resolvePrintingsLookup>,
): boolean {
  if (lookup.oracleId && card.oracle_id === lookup.oracleId) return true;

  const cardName = normalizeDoubleFacedCardName(card.name ?? '');
  const scryfallName = normalizeDoubleFacedCardName(lookup.scryfallName);
  const deckName = normalizeDoubleFacedCardName(lookup.deckName);

  if (cardName && (cardName === scryfallName || cardName === deckName)) return true;

  const frontFaceName = card.card_faces?.[0]?.name ?? cardName.split(' // ')[0];
  if (frontFaceName) {
    const normalizedFront = normalizeDoubleFacedCardName(frontFaceName);
    if (normalizedFront === deckName || normalizedFront === scryfallName) return true;
  }

  return false;
}

export function buildDefaultPrintingsSearchQuery(lookup: ReturnType<typeof resolvePrintingsLookup>): string {
  if (lookup.oracleId) {
    return `oracle_id:${lookup.oracleId} unique:prints`;
  }
  const quoted = lookup.scryfallName.replace(/"/g, '\\"');
  if (!quoted) return 'unique:prints';
  return `!"${quoted}" unique:prints`;
}

export type PrintingsLanguageFilter = 'en' | 'es';

export function buildPrintingsSearchQuery(
  lookup: ReturnType<typeof resolvePrintingsLookup>,
  language: PrintingsLanguageFilter,
): string {
  const base = buildDefaultPrintingsSearchQuery(lookup);
  return `lang:${language} ${base}`;
}

function normalizeSetCode(set?: string) {
  return set?.trim().toLowerCase() || undefined;
}

function normalizeCollectorNumber(collectorNumber?: string | number) {
  if (collectorNumber == null) return undefined;
  const normalized = String(collectorNumber).trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^\d+$/.test(normalized)) {
    return String(Number.parseInt(normalized, 10));
  }
  return normalized;
}

function normalizeSetLabel(set?: string) {
  const normalized = normalizeSetCode(set);
  if (!normalized) return undefined;
  return normalized.replace(/[^a-z0-9]/g, '');
}

function resolvedSetsMatch(requestedSet: string | undefined, detail: CardEntryDetail) {
  if (!requestedSet) return true;

  const resolvedSet = normalizeSetCode(detail.set);
  const resolvedSetName = normalizeSetCode(
    (detail as CardEntryDetail & { set_name?: string }).set_name,
  );
  const normalizedRequest = normalizeSetLabel(requestedSet);

  if (!resolvedSet && !resolvedSetName) return true;

  if (resolvedSet && normalizeSetLabel(resolvedSet) === normalizedRequest) return true;
  if (resolvedSetName && normalizeSetLabel(resolvedSetName) === normalizedRequest) return true;

  return false;
}

export function hasRequestedPrinting(entry: CardEntry) {
  return !!(
    entry.id?.trim() ||
    normalizeSetCode(entry.set) ||
    normalizeCollectorNumber(entry.collector_number)
  );
}

export function printingMatchesRequest(detail: CardEntryDetail, entry: CardEntry) {
  const requestedId = entry.id?.trim();
  const detailId = (detail as CardEntryDetail & { id?: string }).id?.trim();
  if (requestedId) {
    if (!detailId || requestedId !== detailId) return false;
  }

  const requestedSet = normalizeSetCode(entry.set);
  const requestedCollector = normalizeCollectorNumber(entry.collector_number);
  if (!requestedSet && !requestedCollector) return true;

  if (!resolvedSetsMatch(requestedSet, detail)) return false;

  const payloadCollector = normalizeCollectorNumber(detail.collector_number);
  if (requestedCollector && payloadCollector && payloadCollector !== requestedCollector) {
    return false;
  }
  return true;
}

export function normalizePrintingSetCode(set?: string) {
  return normalizeSetCode(set);
}

export function normalizePrintingCollectorNumber(collectorNumber?: string | number) {
  return normalizeCollectorNumber(collectorNumber);
}
