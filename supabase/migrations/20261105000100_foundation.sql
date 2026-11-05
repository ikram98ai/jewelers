-- =============================================================================
-- Foundation: profiles, role helpers, shop settings, categories, audit log.
--
-- Security model (see design NFR-1):
--   * The browser only ever holds the anon key. Postgres is the security boundary.
--   * RLS is enabled on every table; default is deny.
--   * `anon` gets nothing in `public`. `authenticated` gets only what is granted
--     explicitly below or in later migrations.
--   * All business writes that touch stock or money go through SECURITY DEFINER
--     functions with a pinned search_path.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Default-deny grants. Supabase grants broad privileges on public to anon and
-- authenticated by default; we take them back and grant per table instead.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
-- Supabase's own roles still need these for migrations, the dashboard and Edge Functions.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.prevent_update_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;

-- -----------------------------------------------------------------------------
-- Profiles: one per employee, 1:1 with auth.users. Created only by the
-- admin-users Edge Function (service role). Never deleted: deactivate instead.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete restrict,
  username    text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  full_name   text not null check (length(btrim(full_name)) between 1 and 120),
  role        text not null default 'staff' check (role in ('admin', 'staff')),
  phone       text check (phone is null or length(phone) <= 30),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Role helpers. SECURITY DEFINER so RLS policies can call them without
-- recursing into profiles' own policies. `(select auth.uid())` is evaluated once
-- per statement (initPlan), which keeps policies fast.
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'admin'
  );
$$;

create or replace function public.require_active_user()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
end $$;

create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
end $$;

grant execute on function public.is_active_user(), public.is_admin() to authenticated;

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated using (public.is_active_user());

-- Users may edit their own phone; admins may edit name/phone of anyone.
-- role/active are changed only by the Edge Function (service role), which
-- enforces the last-admin guard.
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin() or id = (select auth.uid()))
  with check (public.is_admin() or id = (select auth.uid()));

grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Service role (Edge Function, migrations) has no auth.uid() and may do anything.
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.full_name is distinct from old.full_name and not public.is_admin() then
    raise exception 'Only an admin can change names' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- -----------------------------------------------------------------------------
-- Employee HR data: admin only.
-- -----------------------------------------------------------------------------
create table public.employee_hr (
  profile_id         uuid primary key references public.profiles (id) on delete restrict,
  joined_on          date,
  left_on            date,
  monthly_salary     numeric(12, 2) check (monthly_salary is null or monthly_salary >= 0),
  national_id        text,
  address            text,
  emergency_contact  text,
  notes              text,
  updated_at         timestamptz not null default now()
);
create trigger employee_hr_updated_at before update on public.employee_hr
  for each row execute function public.set_updated_at();

alter table public.employee_hr enable row level security;
create policy employee_hr_admin on public.employee_hr
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.employee_hr to authenticated;

-- -----------------------------------------------------------------------------
-- Shop settings (singleton row id = 1).
-- -----------------------------------------------------------------------------
create table public.shop_settings (
  id                      int primary key default 1 check (id = 1),
  shop_name               text not null default 'My Jewelers',
  address                 text,
  phone                   text,
  currency_code           text not null default 'PKR' check (currency_code ~ '^[A-Z]{3}$'),
  currency_symbol         text not null default 'Rs',
  weight_unit             text not null default 'g' check (weight_unit in ('g', 'tola')),
  invoice_prefix          text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  old_gold_deduction_pct  numeric(5, 2) not null default 0 check (old_gold_deduction_pct between 0 and 50),
  timezone                text not null default 'Asia/Karachi',
  phone_country_code      text not null default '92' check (phone_country_code ~ '^[0-9]{1,4}$'),
  updated_at              timestamptz not null default now()
);
insert into public.shop_settings (id) values (1);
create trigger shop_settings_updated_at before update on public.shop_settings
  for each row execute function public.set_updated_at();

-- Validate the timezone name so shop_today() can never fail at runtime.
create or replace function public.shop_settings_validate()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when others then
  raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
end $$;
create trigger shop_settings_validate before insert or update on public.shop_settings
  for each row execute function public.shop_settings_validate();

alter table public.shop_settings enable row level security;
create policy shop_settings_select on public.shop_settings
  for select to authenticated using (public.is_active_user());
create policy shop_settings_update on public.shop_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.shop_settings to authenticated;
grant update (shop_name, address, phone, currency_code, currency_symbol, weight_unit,
              invoice_prefix, old_gold_deduction_pct, timezone, phone_country_code)
  on public.shop_settings to authenticated;

-- "Today" in the shop's timezone, not UTC. Used for rates and reports.
create or replace function public.shop_today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone s.timezone)::date from public.shop_settings s where s.id = 1;
$$;
grant execute on function public.shop_today() to authenticated;

-- -----------------------------------------------------------------------------
-- Categories (Ring, Necklace, ...). The tag prefix + sequence generate item tags.
-- -----------------------------------------------------------------------------
create table public.categories (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (length(btrim(name)) between 1 and 60),
  tag_prefix        text not null unique check (tag_prefix ~ '^[A-Z]{2,5}$'),
  next_seq          int  not null default 1 check (next_seq >= 1),
  default_tracking  text not null default 'piece' check (default_tracking in ('piece', 'bulk')),
  created_at        timestamptz not null default now()
);

alter table public.categories enable row level security;
create policy categories_select on public.categories
  for select to authenticated using (public.is_active_user());
create policy categories_insert on public.categories
  for insert to authenticated with check (public.is_admin());
create policy categories_update on public.categories
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.categories to authenticated;
grant insert (name, tag_prefix, default_tracking) on public.categories to authenticated;
grant update (name, default_tracking) on public.categories to authenticated;

insert into public.categories (name, tag_prefix, default_tracking) values
  ('Ring', 'RNG', 'piece'),
  ('Necklace', 'NCK', 'piece'),
  ('Earrings', 'EAR', 'piece'),
  ('Bangle', 'BNG', 'piece'),
  ('Bracelet', 'BRC', 'piece'),
  ('Chain', 'CHN', 'piece'),
  ('Pendant', 'PND', 'piece'),
  ('Set', 'SET', 'piece'),
  ('Nose pin', 'NSP', 'bulk'),
  ('Anklet', 'ANK', 'bulk');

-- -----------------------------------------------------------------------------
-- Audit log: who changed what, with old/new row images. Admin read only.
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text not null,
  action      text not null check (action in ('insert', 'update')),
  old_data    jsonb,
  new_data    jsonb,
  actor       uuid references public.profiles (id),
  at          timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (table_name, row_id);
create index audit_log_at_idx  on public.audit_log (at desc);

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.prevent_update_delete();

alter table public.audit_log enable row level security;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated using (public.is_admin());
grant select on public.audit_log to authenticated;

-- Trigger: audit_row('<pk column>'). Stores only changed columns' old values on
-- update to keep the log compact; new_data always holds the full new row.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pk_col   text := coalesce(tg_argv[0], 'id');
  new_row  jsonb := to_jsonb(new);
  old_row  jsonb;
  changed  jsonb;
  actor_id uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb) into changed
    from jsonb_each(old_row) o
    where o.value is distinct from new_row -> o.key
      and o.key <> 'updated_at';
    if changed = '{}'::jsonb then
      return new;  -- no-op update
    end if;
  end if;

  -- The actor must be a profile (FK). Service-role writes have no uid.
  if actor_id is not null and not exists (select 1 from public.profiles where id = actor_id) then
    actor_id := null;
  end if;

  insert into public.audit_log (table_name, row_id, action, old_data, new_data, actor)
  values (tg_table_name, new_row ->> pk_col, lower(tg_op), changed, new_row, actor_id);
  return new;
end $$;

create trigger audit after insert or update on public.profiles
  for each row execute function public.audit_row('id');
create trigger audit after insert or update on public.employee_hr
  for each row execute function public.audit_row('profile_id');
create trigger audit after insert or update on public.shop_settings
  for each row execute function public.audit_row('id');
create trigger audit after insert or update on public.categories
  for each row execute function public.audit_row('id');
