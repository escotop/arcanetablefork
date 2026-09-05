import uniqBy from 'lodash-es/uniqBy';
import { CardEntryDetail, DetailedCardEntry } from './constants';
import { applyCustomArtToEntry } from './customCardArt';
import { getCardById } from './scryfall/client';

type TokenSource = { detail?: { all_parts?: CardEntryDetail['all_parts'] } };

type TokenDetail = CardEntryDetail & { oracle_id?: string };

export function getTokenKey(detail: TokenDetail) {
  return detail.oracle_id ?? detail.id ?? detail.name;
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
  const token = defaults?.find(entry => getTokenKey(entry as TokenDetail) === tokenKey);
  return token ? tokenDetailToEntry(token) : undefined;
}

export function collectTokenPartIds(sources: TokenSource[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const part of source.detail?.all_parts ?? []) {
      if (part.component === 'token' && part.id) {
        ids.add(part.id);
      }
    }
  }
  return [...ids];
}

export async function resolveTokensByIds(ids: string[]): Promise<CardEntryDetail[]> {
  if (!ids.length) return [];

  const tokens = await Promise.all(ids.map(id => getCardById(id)));

  return uniqBy(
    tokens.filter((token): token is CardEntryDetail => token !== null),
    token => getTokenKey(token as TokenDetail),
  ).sort((a, b) => a.name.localeCompare(b.name));
}

export function findSavedTokenOverride(
  key: string,
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry | undefined {
  if (!saved) return undefined;
  if (saved[key]) return saved[key];
  return Object.values(saved).find(entry => getTokenKey(entry.detail) === key);
}

export function mergeTokenPrintings(
  tokens: CardEntryDetail[],
  saved: Record<string, DetailedCardEntry> | undefined,
): DetailedCardEntry[] {
  return tokens.map(token => {
    const key = getTokenKey(token as TokenDetail);
    const override = findSavedTokenOverride(key, saved);
    if (override) {
      return applyCustomArtToEntry({
        ...override,
        qty: 1,
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
