import { createStore, produce } from 'solid-js/store';
import { toast } from 'solid-sonner';
import type { MpcfillCardBackProduct } from './mpcfill/client';
import type { MtgplaymatsProduct } from './mtgplaymats/types';
import { supabase } from './supabase';

/** Favorite playmats and card backs, stored in Supabase for signed-in users. */

type AssetTypes = {
  playmat: MtgplaymatsProduct;
  card_back: MpcfillCardBackProduct;
};
export type AssetKind = keyof AssetTypes;

type Favorite<K extends AssetKind> = { ref: string; item: AssetTypes[K] };

type State = {
  /** Newest first. Missing kind = not loaded yet. */
  [K in AssetKind]?: Favorite<K>[];
};

const [state, setState] = createStore<State>({});
const loading = new Map<AssetKind, Promise<void>>();
let account: string | null = null;

/** Call when the signed-in user changes; drops cached favorites of the previous user. */
export function setAssetFavoritesAccount(uid: string | null) {
  if (uid === account) return;
  account = uid;
  loading.clear();
  setState({ playmat: undefined, card_back: undefined });
}

/** Favorites of a kind (reactive). Loads them the first time they're asked for. */
export function assetFavorites<K extends AssetKind>(kind: K): AssetTypes[K][] {
  const list = state[kind] as Favorite<K>[] | undefined;
  if (list === undefined) void loadFavorites(kind);
  return (list ?? []).map(fav => fav.item);
}

export function isAssetFavorite(kind: AssetKind, id: string | number) {
  return (state[kind] ?? []).some(fav => fav.ref === String(id));
}

async function loadFavorites(kind: AssetKind) {
  if (!supabase || !account || loading.has(kind)) return;
  const uid = account;
  const request = (async () => {
    const { data, error } = await supabase
      .from('asset_favorites')
      .select('ref, data')
      .eq('kind', kind)
      .order('created_at', { ascending: false });
    if (account !== uid) return;
    if (error) {
      console.error('[assetFavorites] load failed', error);
      loading.delete(kind);
      return;
    }
    const favorites = (data as { ref: string; data: unknown }[])
      .filter(row => row.data && typeof row.data === 'object')
      .map(row => ({ ref: row.ref, item: row.data }));
    setState(kind, favorites as never);
  })();
  loading.set(kind, request);
  await request;
}

export async function toggleAssetFavorite<K extends AssetKind>(kind: K, item: AssetTypes[K]) {
  if (!supabase || !account) return;
  const uid = account;
  const ref = String(item.id);
  await loadFavorites(kind);

  const exists = isAssetFavorite(kind, ref);
  const snapshot = JSON.parse(JSON.stringify(item)) as AssetTypes[K];
  const apply = (add: boolean) =>
    setState(
      produce(s => {
        const list = (s[kind] ?? []) as Favorite<K>[];
        const rest = list.filter(fav => fav.ref !== ref);
        (s as Record<AssetKind, unknown>)[kind] = add ? [{ ref, item: snapshot }, ...rest] : rest;
      }),
    );

  apply(!exists); // optimistic

  const { error } = exists
    ? await supabase.from('asset_favorites').delete().match({ kind, ref })
    : await supabase.from('asset_favorites').insert({ kind, ref, data: snapshot });

  if (account !== uid) return;
  // 23505 = already saved (e.g. from another tab): that's fine.
  if (error && error.code !== '23505') {
    console.error('[assetFavorites] save failed', error);
    toast.error(exists ? 'Could not remove favorite' : 'Could not save favorite');
    apply(exists);
  }
}
