-- Favorite playmats and card backs per user.
-- kind 'playmat': ref = MTGPlaymats product id. kind 'card_back': ref = MPC Autofill card id.
-- data: snapshot of the item so it can be shown without refetching the catalog.
create table public.asset_favorites (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint asset_favorites_kind_check check (kind in ('playmat', 'card_back')),
  constraint asset_favorites_ref_check check (char_length(ref) between 1 and 512),
  unique (user_id, kind, ref)
);

create index asset_favorites_lookup_idx on public.asset_favorites (user_id, kind);

alter table public.asset_favorites enable row level security;

create policy "Users read own asset favorites" on public.asset_favorites
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own asset favorites" on public.asset_favorites
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own asset favorites" on public.asset_favorites
  for delete to authenticated using ((select auth.uid()) = user_id);
