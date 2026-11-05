-- =============================================================================
-- Clients. Phone (digits only) is the unique lookup key. Archive, never delete.
-- Design: FR-5; decision "Clients: phone number as the main lookup".
-- =============================================================================

create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null check (length(btrim(full_name)) between 1 and 120),
  phone        text not null unique check (phone ~ '^[0-9]{7,15}$'),
  alt_phone    text check (alt_phone is null or alt_phone ~ '^[0-9]{7,15}$'),
  address      text,
  city         text,
  birthday     date,
  anniversary  date,
  notes        text check (notes is null or length(notes) <= 2000),
  archived     boolean not null default false,
  created_by   uuid not null references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index clients_name_trgm_idx  on public.clients using gin (full_name extensions.gin_trgm_ops);
create index clients_phone_trgm_idx on public.clients using gin (phone extensions.gin_trgm_ops);

-- Normalize phones to digits, so "0300-123 4567" and "03001234567" are the same client.
create or replace function public.clients_normalize()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.phone := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
  if new.alt_phone is not null then
    new.alt_phone := nullif(regexp_replace(new.alt_phone, '[^0-9]', '', 'g'), '');
  end if;
  new.full_name := btrim(new.full_name);
  return new;
end $$;
create trigger clients_normalize before insert or update on public.clients
  for each row execute function public.clients_normalize();
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger audit after insert or update on public.clients
  for each row execute function public.audit_row('id');

alter table public.clients enable row level security;
create policy clients_select on public.clients
  for select to authenticated using (public.is_active_user());
create policy clients_insert on public.clients
  for insert to authenticated with check (public.is_active_user() and created_by = (select auth.uid()));
create policy clients_update on public.clients
  for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
grant select on public.clients to authenticated;
grant insert (full_name, phone, alt_phone, address, city, birthday, anniversary, notes) on public.clients to authenticated;
grant update (full_name, phone, alt_phone, address, city, birthday, anniversary, notes, archived) on public.clients to authenticated;

-- Archiving is admin-only and is enforced in a trigger because RLS cannot see
-- which column changed. The balance check is added in the sales migration.
create or replace function public.clients_archive_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.archived is distinct from old.archived and (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'ADMIN_ONLY: only an admin can archive clients' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger clients_archive_guard before update on public.clients
  for each row execute function public.clients_archive_guard();

create or replace function public.search_clients(p_q text default null, p_include_archived boolean default false)
returns setof public.clients language sql stable set search_path = '' as $$
  select c.*
  from public.clients c
  where (p_include_archived or not c.archived)
    and (
      p_q is null or btrim(p_q) = ''
      or c.full_name ilike '%' || btrim(p_q) || '%'
      or (regexp_replace(p_q, '[^0-9]', '', 'g') <> ''
          and c.phone like '%' || regexp_replace(p_q, '[^0-9]', '', 'g') || '%')
    )
  order by c.full_name;
$$;
grant execute on function public.search_clients(text, boolean) to authenticated;
