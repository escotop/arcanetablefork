-- Favorite printings / custom art per card, per user.
-- card_key: normalized card name (lowercase, trimmed).
-- kind 'printing': ref = Scryfall printing id. kind 'custom_art': ref = image URL.
-- data: snapshot of the option so it can be shown without refetching.
create table public.card_favorites (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_key text not null,
  kind text not null,
  ref text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint card_favorites_kind_check check (kind in ('printing', 'custom_art')),
  constraint card_favorites_card_key_check check (char_length(card_key) between 1 and 200),
  constraint card_favorites_ref_check check (char_length(ref) between 1 and 2048),
  unique (user_id, card_key, kind, ref)
);

create index card_favorites_lookup_idx on public.card_favorites (user_id, card_key);

alter table public.card_favorites enable row level security;

create policy "Users read own card favorites" on public.card_favorites
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own card favorites" on public.card_favorites
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own card favorites" on public.card_favorites
  for delete to authenticated using ((select auth.uid()) = user_id);
