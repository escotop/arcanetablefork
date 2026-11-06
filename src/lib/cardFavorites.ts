import { createStore, produce } from 'solid-js/store';
import { toast } from 'solid-sonner';
import type { CustomCardArtOption } from './customCardArt';
import type { CardPrintingOption } from './deck';
import { supabase } from './supabase';

/** Favorite printings and custom art per card, stored in Supabase for signed-in users. */

export type CardFavorite =
  | { kind: 'printing'; ref: string; printing: CardPrintingOption }
  | { kind: 'custom_art'; ref: string; option: CustomCardArtOption };

type Row = { kind: CardFavorite['kind']; ref: string; data: unknown };

type State = {
  /** Favorites by card key, newest first. Missing key = not loaded yet. */
  byCard: Record<string, CardFavorite[] | undefined>;
};

const [state, setState] = createStore<State>({ byCard: {} });
const loading = new Map<string, Promise<void>>();
let account: string | null = null;

export function cardFavoriteKey(cardName: string) {
  return cardName.trim().toLowerCase();
}

function rowToFavorite(row: Row): CardFavorite | null {
  if (row.kind === 'printing') {
    const printing = row.data as CardPrintingOption;
    return printing?.id ? { kind: 'printing', ref: row.ref, printing } : null;
  }
  if (row.kind === 'custom_art') {
    const option = row.data as CustomCardArtOption;
    return option?.imageUrl ? { kind: 'custom_art', ref: row.ref, option } : null;
  }
  return null;
}

/** Call when the signed-in user changes; drops cached favorites of the previous user. */
export function setCardFavoritesAccount(uid: string | null) {
  if (uid === account) return;
  account = uid;
  loading.clear();
  setState('byCard', {});
}

/** Favorites for a card (reactive). Loads them the first time they're asked for. */
export function cardFavorites(cardName: string): CardFavorite[] {
  const key = cardFavoriteKey(cardName);
  const list = state.byCard[key];
  if (list === undefined) void loadCardFavorites(key);
  return list ?? [];
}

async function loadCardFavorites(key: string) {
  if (!supabase || !account || loading.has(key)) return;
  const uid = account;
  const request = (async () => {
    const { data, error } = await supabase
      .from('card_favorites')
      .select('kind, ref, data')
      .eq('card_key', key)
      .order('created_at', { ascending: false });
    if (account !== uid) return;
    if (error) {
      console.error('[cardFavorites] load failed', error);
      loading.delete(key); // allow a retry next time
      return;
    }
    const favorites = (data as Row[]).map(rowToFavorite).filter(Boolean) as CardFavorite[];
    setState('byCard', key, favorites);
  })();
  loading.set(key, request);
  await request;
}

export function isPrintingFavorite(cardName: string, printingId: string) {
  return cardFavorites(cardName).some(fav => fav.kind === 'printing' && fav.ref === printingId);
}

export function isCustomArtFavorite(cardName: string, imageUrl: string) {
  return cardFavorites(cardName).some(fav => fav.kind === 'custom_art' && fav.ref === imageUrl);
}

/** Strip runtime-only fields so the snapshot is small and JSON-safe. */
function printingSnapshot(printing: CardPrintingOption): CardPrintingOption {
  return JSON.parse(JSON.stringify(printing));
}

export function togglePrintingFavorite(cardName: string, printing: CardPrintingOption) {
  if (!printing.id) return;
  return toggleFavorite(cardName, {
    kind: 'printing',
    ref: printing.id,
    printing: printingSnapshot(printing),
  });
}

export function toggleCustomArtFavorite(cardName: string, option: CustomCardArtOption) {
  if (!option.imageUrl) return;
  return toggleFavorite(cardName, {
    kind: 'custom_art',
    ref: option.imageUrl,
    option: { ...option, id: `favorite-${option.imageUrl}` },
  });
}

async function toggleFavorite(cardName: string, favorite: CardFavorite) {
  if (!supabase || !account) return;
  const key = cardFavoriteKey(cardName);
  const uid = account;
  await loadCardFavorites(key);

  const current = state.byCard[key] ?? [];
  const exists = current.some(fav => fav.kind === favorite.kind && fav.ref === favorite.ref);
  const matches = (fav: CardFavorite) => fav.kind === favorite.kind && fav.ref === favorite.ref;

  // Optimistic update, reverted on error.
  setState(
    produce(s => {
      const list = s.byCard[key] ?? [];
      s.byCard[key] = exists ? list.filter(fav => !matches(fav)) : [favorite, ...list];
    }),
  );

  const { error } = exists
    ? await supabase
        .from('card_favorites')
        .delete()
        .match({ card_key: key, kind: favorite.kind, ref: favorite.ref })
    : await supabase.from('card_favorites').insert({
        card_key: key,
        kind: favorite.kind,
        ref: favorite.ref,
        data: favorite.kind === 'printing' ? favorite.printing : favorite.option,
      });

  if (account !== uid) return;
  // 23505 = already saved (e.g. from another tab): that's fine.
  if (error && error.code !== '23505') {
    console.error('[cardFavorites] save failed', error);
    toast.error(exists ? 'Could not remove favorite' : 'Could not save favorite');
    setState(
      produce(s => {
        const list = s.byCard[key] ?? [];
        s.byCard[key] = exists ? [favorite, ...list.filter(fav => !matches(fav))] : list.filter(fav => !matches(fav));
      }),
    );
  }
}
