-- Safety net for decks: every delete, and the previous version before an overwrite,
-- is copied here (deck row + its cards) so it can be restored.

create table public.deck_backups (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  deck_id text not null,
  reason text not null,
  deck jsonb not null,
  cards jsonb not null default '[]',
  created_at timestamptz not null default now(),
  constraint deck_backups_reason_check check (reason in ('delete', 'update'))
);

create index deck_backups_lookup_idx on public.deck_backups (user_id, deck_id, created_at desc);

alter table public.deck_backups enable row level security;

-- Users can see their own backups. Rows are only written by the trigger below.
create policy "Users read own deck backups" on public.deck_backups
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.backup_deck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := case when tg_op = 'DELETE' then 'delete' else 'update' end;
begin
  -- Overwrites are frequent while editing: keep at most one copy every 10 minutes.
  if v_reason = 'update' and exists (
    select 1 from public.deck_backups b
    where b.user_id = old.user_id
      and b.deck_id = old.id
      and b.reason = 'update'
      and b.created_at > now() - interval '10 minutes'
  ) then
    return new;
  end if;

  insert into public.deck_backups (user_id, deck_id, reason, deck, cards)
  values (
    old.user_id,
    old.id,
    v_reason,
    to_jsonb(old),
    coalesce(
      (
        select jsonb_agg(to_jsonb(c) order by c.section, c.position)
        from public.deck_cards c
        where c.user_id = old.user_id and c.deck_id = old.id
      ),
      '[]'::jsonb
    )
  );

  -- Keep the 30 most recent copies per deck.
  delete from public.deck_backups b
  where b.user_id = old.user_id
    and b.deck_id = old.id
    and b.id not in (
      select b2.id from public.deck_backups b2
      where b2.user_id = old.user_id and b2.deck_id = old.id
      order by b2.created_at desc, b2.id desc
      limit 30
    );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.backup_deck() from public, anon, authenticated;

-- BEFORE triggers: the deck's cards still exist at this point (save_deck rewrites
-- them after updating the deck row; ON DELETE CASCADE removes them after the delete).
create trigger decks_backup_before_update
  before update on public.decks
  for each row execute function public.backup_deck();

create trigger decks_backup_before_delete
  before delete on public.decks
  for each row execute function public.backup_deck();

-- Restores a backup as the current version of that deck. Runs as the caller (RLS applies).
create function public.restore_deck_backup(p_backup_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_backup public.deck_backups;
  v_deck jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_backup from public.deck_backups
  where id = p_backup_id and user_id = v_uid;
  if not found then
    raise exception 'Backup not found' using errcode = 'P0002';
  end if;

  v_deck := v_backup.deck;

  perform public.save_deck(
    v_deck,
    coalesce(
      (
        select jsonb_agg(c - 'id' - 'user_id' - 'deck_id' order by (c ->> 'section'), (c ->> 'position')::integer)
        from jsonb_array_elements(v_backup.cards) as t(c)
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke execute on function public.restore_deck_backup(bigint) from public, anon;
grant execute on function public.restore_deck_backup(bigint) to authenticated;
