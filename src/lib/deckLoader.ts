import { CardEntry, DetailedCardEntry } from './constants';
import { populateCardInfo } from './deck';
import { deck as deckParser } from './deckParser';

export function loadCardList(cardList: string): CardEntry[] {
  return deckParser.run(cardList).result;
}

export async function fetchCardInfo(
  entry: CardEntry,
  cache?: Map<string, DetailedCardEntry>,
): Promise<DetailedCardEntry> {
  const url = new URL(cardSystem.cardDetailEndpoint);
  url.searchParams.set('exact', entry.name);

  if (entry.id) {
    url.searchParams.set('id', entry.id);
  }
  if (entry.set) {
    url.searchParams.set('set', entry.set);
  }

  let urlString = url.toString();

  if (cache && cache.has(urlString + entry.qty)) {
    return cache.get(urlString + entry.qty)!;
  }

  let result = await fetch(urlString, { cache: 'force-cache' })
    .then(r => r.json())
    .then(r => {
      if (r.status !== 404) return r;
      url.searchParams.delete('set');
      return fetch(url.toString(), { cache: 'force-cache' }).then(r => r.json());
    })
    .then(async payload => {
      return {
        ...entry,
        ...populateCardInfo(payload, entry),
      };
    });

  if (cache) {
    cache.set(urlString + entry.qty, result);
  }

  return result;
}

export function populateCardInfo(detail: CardEntryDetail, entry?: Card) {
  let fields = {
    id: entry?.id || detail?.id,
    set: entry?.set || detail?.set,
    name: entry?.name || detail.name,
    search: getSearchLine(detail),
    popularity: detail?.popularity ?? detail[cardSystem.popularity],
  };

  return {
    ...fields,
    detail: {
      ...detail,
      ...fields,
    },
  };
}
