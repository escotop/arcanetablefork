import { CardEntry, CardEntryDetail } from './constants';

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
  return !!(normalizeSetCode(entry.set) || normalizeCollectorNumber(entry.collector_number));
}

export function printingMatchesRequest(detail: CardEntryDetail, entry: CardEntry) {
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
