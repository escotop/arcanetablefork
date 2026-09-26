import uniqBy from 'lodash-es/uniqBy';
import { CardEntryDetail, DetailedCardEntry } from './constants';
import { applyCustomArtToEntry } from './customCardArt';
import { getDeckStore } from './deckStore';
import { loadGameMeta } from './gameMeta';
import type { PlayArea } from './playArea';
import { getCachedCardById, setCachedCardDetail } from './scryfallCache';
import { mapScryfallCard, postCardCollection } from './scryfall/client';

type TokenSource = { id?: string; detail?: { all_parts?: CardEntryDetail['all_parts']; id?: string } };

type TokenDetail = CardEntryDetail & { oracle_id?: string };

const COLLECTION_BATCH_SIZE = 75;
const TOKEN_MENU_RESULT_CACHE_LIMIT = 4;

const parentTokenPartIdsCache = new Map<string, string[]>();
const tokenMenuResultCache = new Map<string, DetailedCardEntry[]>();

function rememberParentTokenParts(detail: CardEntryDetail) {
  const parentId = (detail as CardEntryDetail & { id?: string }).id?.trim();
  if (!parentId) return;
  const partIds = (detail.all_parts ?? [])
    .filter(part => part.component === 'token')
    .map(part => tokenPartId(part))
    .filter((id): id is string => !!id);
  if (partIds.length) parentTokenPartIdsCache.set(parentId, partIds);
}

function tokenMenuCacheKey(
  sources: TokenSource[],
  saved?: Record<string, DetailedCardEntry>,
  parentLookupSources?: TokenSource[],
) {
  const direct = collectTokenPartIds(sources).sort().join(',');
  const parents = collectParentCardIdsForTokenLookup(parentLookupSources ?? sources)
    .sort()
    .join(',');
  const savedKeys = saved ? Object.keys(saved).sort().join(',') : '';
  return `${direct}|${parents}|${savedKeys}`;
}

function rememberTokenMenuResult(
  key: string,
  merged: DetailedCardEntry[],
) {
  if (tokenMenuResultCache.has(key)) tokenMenuResultCache.delete(key);
  tokenMenuResultCache.set(key, merged);
  while (tokenMenuResultCache.size > TOKEN_MENU_RESULT_CACHE_LIMIT) {
    const oldest = tokenMenuResultCache.keys().next().value;
    if (oldest === undefined) break;
    tokenMenuResultCache.delete(oldest);
  }
}

async function loadCachedCardsByIds(ids: string[]) {
  const pairs = await Promise.all(
    ids.map(async id => [id, await getCachedCardById(id)] as const),
  );
  return new Map(pairs.filter((entry): entry is [string, CardEntryDetail] => !!entry[1]));
}

function parentCardId(source: TokenSource): string | undefined {
  return source.detail?.id?.trim() || source.id?.trim() || undefined;
}

export function getTokenKey(detail: TokenDetail | null | undefined): string {
  if (!detail) return '';
  return detail.oracle_id ?? detail.id ?? detail.name ?? '';
}

function isUsableTokenDetail(detail: TokenDetail | null | undefined): detail is TokenDetail {
  return !!getTokenKey(detail);
}

export function tokenDetailToEntry(token: CardEntryDetail): DetailedCardEntry {
  return {
    id: token.id,
    name: token.name,
    qty: 1,
    set: token.set ?? '',
    collector_number: token.collector_number,
    categories: [],
    detail: token,
  };
}

export function getDefaultTokenEntry(
  tokenKey: string,
  defaults: CardEntryDetail[] | undefined,
): DetailedCardEntry | undefined {
  const token = defaults?.find(
    entry => isUsableTokenDetail(entry) && getTokenKey(entry) === tokenKey,
  );
  return token ? tokenDetailToEntry(token) : undefined;
}

export function tokenPartId(part: { id?: string; uri?: string }): string | undefined {
  if (part.id?.trim()) return part.id.trim();
  const uri = part.uri?.trim();
  if (!uri) return undefined;
  const match = uri.match(/\/cards\/([0-9a-f-]{36})/i);
  return match?.[1];
}

export function collectTokenPartIds(sources: TokenSource[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const part of source.detail?.all_parts ?? []) {
      if (part.component !== 'token') continue;
      const id = tokenPartId(part);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function sourceHasTokenParts(source: TokenSource) {
  return (source.detail?.all_parts ?? []).some(part => part.component === 'token' && tokenPartId(part));
}

export function collectParentCardIdsForTokenLookup(sources: TokenSource[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    if (sourceHasTokenParts(source)) continue;
    const parentId = parentCardId(source);
    if (parentId) ids.add(parentId);
  }
  return [...ids];
}

async function fetchCardDetailsByIds(ids: string[]): Promise<CardEntryDetail[]> {
  if (!ids.length) return [];

  const results: CardEntryDetail[] = [];
  const needsNetwork: string[] = [];
  const cachedById = await loadCachedCardsByIds(ids);

  for (const id of ids) {
    const remembered = parentTokenPartIdsCache.get(id);
    if (remembered?.length) continue;

    const cached = cachedById.get(id);
    if (cached?.all_parts?.some(part => part.component === 'token')) {
      rememberParentTokenParts(cached);
      results.push(cached);
      continue;
    }
    needsNetwork.push(id);
  }

  for (let index = 0; index < needsNetwork.length; index += COLLECTION_BATCH_SIZE) {
    const batch = needsNetwork.slice(index, index + COLLECTION_BATCH_SIZE);
    const body = await postCardCollection(batch.map(id => ({ id })));
    for (const raw of body.data ?? []) {
      const mapped = mapScryfallCard(raw as Record<string, unknown>);
      rememberParentTokenParts(mapped);
      results.push(mapped);
      void setCachedCardDetail(mapped);
    }
  }

  return results;
}

export async function resolveTokenPartIdsFromSources(
  sources: TokenSource[],
  parentLookupSources?: TokenSource[],
): Promise<string[]> {
  const ids = new Set(collectTokenPartIds(sources));
  const parentIds = collectParentCardIdsForTokenLookup(parentLookupSources ?? sources);

  for (const parentId of parentIds) {
    for (const partId of parentTokenPartIdsCache.get(parentId) ?? []) {
      ids.add(partId);
    }
  }

  const parentsToFetch = parentIds.filter(id => !parentTokenPartIdsCache.has(id));
  if (parentsToFetch.length) {
    const parents = await fetchCardDetailsByIds(parentsToFetch);
    for (const parent of parents) {
      for (const part of parent.all_parts ?? []) {
        if (part.component !== 'token') continue;
        const id = tokenPartId(part);
        if (id) ids.add(id);
      }
    }
  }

  return [...ids];
}

async function fetchTokenDetailsByIds(ids: string[]): Promise<CardEntryDetail[]> {
  if (!ids.length) return [];

  const resolved: CardEntryDetail[] = [];
  const missing: string[] = [];
  const cachedById = await loadCachedCardsByIds(ids);

  for (const id of ids) {
    const cached = cachedById.get(id);
    if (cached?.name && Object.keys(cached.image_uris ?? {}).length > 0) {
      resolved.push(cached);
    } else {
      missing.push(id);
    }
  }

  for (let index = 0; index < missing.length; index += COLLECTION_BATCH_SIZE) {
    const batch = missing.slice(index, index + COLLECTION_BATCH_SIZE);
    const body = await postCardCollection(batch.map(id => ({ id })));
    for (const raw of body.data ?? []) {
      const mapped = mapScryfallCard(raw as Record<string, unknown>);
      resolved.push(mapped);
      void setCachedCardDetail(mapped);
    }
  }

  return resolved;
}

export async function resolveTokensByIds(ids: string[]): Promise<CardEntryDetail[]> {
  if (!ids.length) return [];

  const tokens = await fetchTokenDetailsByIds(ids);

  return uniqBy(
    tokens.filter(isUsableTokenDetail),
    token => getTokenKey(token),
  ).sort((a, b) => a.name.localeCompare(b.name));
}

export function findSavedTokenOverride(
  key: string,
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry | undefined {
  if (!saved) return undefined;
  if (saved[key]) return saved[key];
  return Object.values(saved).find(
    entry => isUsableTokenDetail(entry?.detail) && getTokenKey(entry.detail) === key,
  );
}

export function mergeTokenPrintings(
  tokens: CardEntryDetail[],
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry[] {
  return tokens.filter(isUsableTokenDetail).map(token => {
    const key = getTokenKey(token);
    const override = findSavedTokenOverride(key, saved);
    if (override) {
      return applyCustomArtToEntry({
        ...override,
        qty: override.qty ?? 1,
        name: override.name ?? token.name,
        categories: override.categories ?? [],
        detail: override.detail ?? token,
      });
    }

    return {
      id: token.id,
      name: token.name,
      qty: 1,
      set: token.set ?? '',
      collector_number: token.collector_number,
      categories: [],
      detail: token,
    };
  });
}

export function appendSavedTokenPrintings(
  tokens: DetailedCardEntry[],
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry[] {
  if (!saved) return tokens;

  const merged = [...tokens];
  const mergedKeys = new Set(
    merged.filter(entry => isUsableTokenDetail(entry.detail)).map(token => getTokenKey(token.detail)),
  );

  for (const savedEntry of Object.values(saved)) {
    if (!isUsableTokenDetail(savedEntry?.detail)) continue;
    const key = getTokenKey(savedEntry.detail);
    if (mergedKeys.has(key)) continue;
    merged.push(
      applyCustomArtToEntry({
        ...savedEntry,
        qty: 1,
        name: savedEntry.name ?? savedEntry.detail.name,
        categories: savedEntry.categories ?? [],
        detail: savedEntry.detail,
      }),
    );
    mergedKeys.add(key);
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

export function restorePlayAreaTokenPrintings(
  playArea: PlayArea,
  gameId?: string,
  snapshotTokens?: Record<string, DetailedCardEntry>,
) {
  const merged: Record<string, DetailedCardEntry> = {};

  if (gameId) {
    const deckId = loadGameMeta(gameId)?.deckId;
    const deckTokens = deckId ? getDeckStore().decks[deckId]?.tokens : undefined;
    if (deckTokens) Object.assign(merged, deckTokens);
  }

  if (snapshotTokens) Object.assign(merged, snapshotTokens);
  if (playArea.tokenPrintings) Object.assign(merged, playArea.tokenPrintings);

  playArea.tokenPrintings = Object.keys(merged).length > 0 ? merged : undefined;
}

/** Resolve display-ready tokens for cards/tokens in play or in a deck list. */
export async function resolveTokensForSources(sources: TokenSource[]): Promise<CardEntryDetail[]> {
  const ids = await resolveTokenPartIdsFromSources(sources);
  return resolveTokensByIds(ids);
}

export async function resolveTokenMenuEntries(
  sources: TokenSource[],
  saved: Record<string, DetailedCardEntry> | undefined,
  parentLookupSources?: TokenSource[],
): Promise<DetailedCardEntry[]> {
  const cacheKey = tokenMenuCacheKey(sources, saved, parentLookupSources);
  const cached = tokenMenuResultCache.get(cacheKey);
  if (cached) return cached;

  const tokenIds = await resolveTokenPartIdsFromSources(sources, parentLookupSources);
  const tokenDetails = await resolveTokensByIds(tokenIds);
  const merged = appendSavedTokenPrintings(mergeTokenPrintings(tokenDetails, saved), saved);
  rememberTokenMenuResult(cacheKey, merged);
  return merged;
}

export function prefetchTokenMenuEntries(
  sources: TokenSource[],
  saved: Record<string, DetailedCardEntry> | undefined,
  parentLookupSources?: TokenSource[],
) {
  const cacheKey = tokenMenuCacheKey(sources, saved, parentLookupSources);
  if (tokenMenuResultCache.has(cacheKey)) return;
  void resolveTokenMenuEntries(sources, saved, parentLookupSources);
}
