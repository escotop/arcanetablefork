-- User decks. `id` is the client-generated deck id (nanoid), unique per user.
create table public.decks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null default '',
  system text not null default '',
  version integer not null default 0,
  starting_life integer not null default 40,
  bracket_estimate numeric,
  tags text[] not null default '{}',
  cover_image text,
  cover_image_full_art boolean,
  card_list text,
  counters jsonb,
  how_it_plays_advice jsonb,
  -- Any other deck fields the client stores, so nothing is lost on round-trip.
  extra jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint decks_id_not_empty check (char_length(id) between 1 and 64)
);

create table public.deck_cards (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  deck_id text not null,
  section text not null,
  -- Key of the entry inside its section on the client.
  card_key text not null,
  position integer not null default 0,
  card_id text not null default '',
  name text not null default '',
  qty integer not null default 1,
  set text not null default '',
  collector_number text,
  custom_art_url text,
  categories text[] not null default '{}',
  manual_token boolean not null default false,
  extra jsonb not null default '{}',
  foreign key (user_id, deck_id) references public.decks (user_id, id) on delete cascade,
  constraint deck_cards_section_check check (section in ('main', 'in_play', 'sideboard', 'tokens')),
  constraint deck_cards_qty_check check (qty >= 0),
  unique (user_id, deck_id, section, card_key)
);

create index deck_cards_deck_idx on public.deck_cards (user_id, deck_id);

alter table public.decks enable row level security;
alter table public.deck_cards enable row level security;

create policy "Users read own decks" on public.decks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own decks" on public.decks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own decks" on public.decks
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own decks" on public.decks
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own deck cards" on public.deck_cards
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own deck cards" on public.deck_cards
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own deck cards" on public.deck_cards
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own deck cards" on public.deck_cards
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger decks_set_updated_at
  before update on public.decks
  for each row execute function public.set_updated_at();

-- Saves a whole deck (fields + cards) in one transaction.
-- p_deck: deck columns as JSON (snake_case). p_cards: array of card rows.
-- Runs as the caller, so RLS applies.
create function public.save_deck(p_deck jsonb, p_cards jsonb)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := p_deck ->> 'id';
  v_updated timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.decks as d (
    user_id, id, name, system, version, starting_life, bracket_estimate, tags,
    cover_image, cover_image_full_art, card_list, counters, how_it_plays_advice, extra
  )
  values (
    v_uid,
    v_id,
    coalesce(p_deck ->> 'name', ''),
    coalesce(p_deck ->> 'system', ''),
    coalesce((p_deck ->> 'version')::integer, 0),
    coalesce((p_deck ->> 'starting_life')::integer, 40),
    (p_deck ->> 'bracket_estimate')::numeric,
    coalesce(array(select jsonb_array_elements_text(p_deck -> 'tags')), '{}'),
    p_deck ->> 'cover_image',
    (p_deck ->> 'cover_image_full_art')::boolean,
    p_deck ->> 'card_list',
    p_deck -> 'counters',
    p_deck -> 'how_it_plays_advice',
    coalesce(p_deck -> 'extra', '{}')
  )
  on conflict (user_id, id) do update set
    name = excluded.name,
    system = excluded.system,
    version = excluded.version,
    starting_life = excluded.starting_life,
    bracket_estimate = excluded.bracket_estimate,
    tags = excluded.tags,
    cover_image = excluded.cover_image,
    cover_image_full_art = excluded.cover_image_full_art,
    card_list = excluded.card_list,
    counters = excluded.counters,
    how_it_plays_advice = excluded.how_it_plays_advice,
    extra = excluded.extra
  returning d.updated_at into v_updated;

  delete from public.deck_cards where user_id = v_uid and deck_id = v_id;

  insert into public.deck_cards (
    user_id, deck_id, section, card_key, position, card_id, name, qty, set,
    collector_number, custom_art_url, categories, manual_token, extra
  )
  select
    v_uid,
    v_id,
    c ->> 'section',
    c ->> 'card_key',
    (pos - 1)::integer,
    coalesce(c ->> 'card_id', ''),
    coalesce(c ->> 'name', ''),
    coalesce((c ->> 'qty')::integer, 1),
    coalesce(c ->> 'set', ''),
    c ->> 'collector_number',
    c ->> 'custom_art_url',
    coalesce(array(select jsonb_array_elements_text(c -> 'categories')), '{}'),
    coalesce((c ->> 'manual_token')::boolean, false),
    coalesce(c -> 'extra', '{}')
  from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) with ordinality as t(c, pos);

  return v_updated;
end;
$$;

revoke execute on function public.save_deck(jsonb, jsonb) from public, anon;
grant execute on function public.save_deck(jsonb, jsonb) to authenticated;
