-- =============================================================================
-- 1. Set contents: a set (bridal set etc.) is one tagged, priced item whose
--    parts (necklace, earrings, bangles, ring, tikka…) are listed with their own
--    weight, quantity and photo.
-- 2. Safekeeping (amanat): gold a client leaves with the shop — bought here or
--    their own — against a numbered receipt, released only when that receipt
--    number is presented. Held gold is the client's, never shop stock.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Set contents
-- -----------------------------------------------------------------------------
create table public.item_components (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.items (id) on delete restrict,
  kind            text not null check (kind in ('necklace', 'earrings', 'ring', 'bangle', 'bracelet', 'tikka',
                                                'pendant', 'chain', 'nose_pin', 'anklet', 'jhoomar', 'other')),
  description     text check (description is null or length(description) <= 200),
  qty             int not null default 1 check (qty between 1 and 50),
  gross_weight_g  numeric(10, 3) check (gross_weight_g is null or gross_weight_g > 0),
  stone_weight_g  numeric(10, 3) not null default 0 check (stone_weight_g >= 0),
  photo_path      text unique check (photo_path is null or photo_path like item_id::text || '/parts/%'),
  sort_order      int not null default 0,
  created_by      uuid not null references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint item_components_stone check (gross_weight_g is null or stone_weight_g <= gross_weight_g)
);
create index item_components_item_idx on public.item_components (item_id, sort_order);
create trigger audit after insert or update on public.item_components
  for each row execute function public.audit_row('id');

alter table public.item_components enable row level security;
create policy item_components_select on public.item_components
  for select to authenticated using (public.is_active_user());
-- Anyone receiving stock may list a set's parts; only admins change or remove them.
create policy item_components_insert on public.item_components
  for insert to authenticated with check (public.is_active_user() and created_by = (select auth.uid()));
create policy item_components_update on public.item_components
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy item_components_delete on public.item_components
  for delete to authenticated using (public.is_admin());
grant select, delete on public.item_components to authenticated;
grant insert (item_id, kind, description, qty, gross_weight_g, stone_weight_g, photo_path, sort_order)
  on public.item_components to authenticated;
grant update (kind, description, qty, gross_weight_g, stone_weight_g, photo_path, sort_order)
  on public.item_components to authenticated;
-- Part photos live in the item-photos bucket under <item_id>/parts/, which the
-- existing storage policies already cover.

-- -----------------------------------------------------------------------------
-- 2. Safekeeping (amanat)
-- -----------------------------------------------------------------------------
create table public.custody_counters (year int primary key, last_no int not null);
alter table public.custody_counters enable row level security;  -- internal only

create table public.custody_receipts (
  id             uuid primary key default gen_random_uuid(),
  receipt_no     text not null unique,
  client_id      uuid not null references public.clients (id),
  sale_id        uuid references public.sales (id),     -- set when the gold was bought here and left with us
  status         text not null default 'held' check (status in ('held', 'returned')),
  note           text check (note is null or length(note) <= 1000),
  received_by    uuid not null references public.profiles (id),
  received_at    timestamptz not null default now(),
  returned_by    uuid references public.profiles (id),
  returned_at    timestamptz,
  returned_to    text,                                   -- who collected it (the client or a named person)
  returned_note  text,
  constraint custody_return_fields check ((status = 'returned') = (returned_at is not null and returned_by is not null))
);
create index custody_receipts_client_idx on public.custody_receipts (client_id, received_at desc);
create index custody_receipts_status_idx on public.custody_receipts (status, received_at desc);

create table public.custody_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.custody_receipts (id) on delete restrict,
  description     text not null check (length(btrim(description)) between 1 and 200),
  metal           text not null check (metal in ('gold', 'silver', 'platinum', 'other')),
  purity          text check (purity is null or purity ~ '^[0-9]{2,3}K?$'),
  qty             int not null default 1 check (qty between 1 and 500),
  gross_weight_g  numeric(10, 3) check (gross_weight_g is null or gross_weight_g > 0),
  item_id         uuid references public.items (id),    -- the sold shop item, when it came from a sale
  sort_order      int not null default 0
);
create index custody_items_receipt_idx on public.custody_items (receipt_id, sort_order);

create table public.custody_photos (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.custody_receipts (id) on delete restrict,
  storage_path  text not null unique check (storage_path like receipt_id::text || '/%'),
  created_by    uuid not null references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create trigger custody_items_append_only before update or delete on public.custody_items
  for each row execute function public.prevent_update_delete();

create or replace function public.custody_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'safekeeping receipts cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status = 'returned' then
    raise exception 'a returned safekeeping receipt cannot be changed' using errcode = 'P0001';
  end if;
  if new.receipt_no <> old.receipt_no or new.client_id <> old.client_id or new.received_at <> old.received_at then
    raise exception 'receipt identity fields are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger custody_guard before update or delete on public.custody_receipts
  for each row execute function public.custody_guard();

create trigger audit after insert or update on public.custody_receipts
  for each row execute function public.audit_row('id');
create trigger audit after insert on public.custody_items
  for each row execute function public.audit_row('id');

alter table public.custody_receipts enable row level security;
alter table public.custody_items enable row level security;
alter table public.custody_photos enable row level security;
create policy custody_receipts_select on public.custody_receipts for select to authenticated using (public.is_active_user());
create policy custody_items_select on public.custody_items for select to authenticated using (public.is_active_user());
create policy custody_photos_select on public.custody_photos for select to authenticated using (public.is_active_user());
create policy custody_photos_insert on public.custody_photos
  for insert to authenticated with check (public.is_active_user() and created_by = (select auth.uid()));
grant select on public.custody_receipts, public.custody_items, public.custody_photos to authenticated;
grant insert (receipt_id, storage_path) on public.custody_photos to authenticated;
-- Receipts and their items are written only through the functions below.

-- Private bucket for safekeeping photos: <receipt_id>/<uuid>.webp
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custody-photos', 'custody-photos', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists custody_photos_read on storage.objects;
drop policy if exists custody_photos_upload on storage.objects;
create policy custody_photos_read on storage.objects
  for select to authenticated using (bucket_id = 'custody-photos' and public.is_active_user());
create policy custody_photos_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'custody-photos' and public.is_active_user()
    and exists (select 1 from public.custody_receipts r
                where r.id::text = (storage.foldername(name))[1] and r.status = 'held')
  );

-- Create a receipt.
--   p_items: [{ "description": "Gold biscuit 1 tola", "metal": "gold", "purity": "24K",
--               "qty": 1, "gross_weight_g": 11.664, "item_id": null }, ...]
-- When p_sale_id is given, the receipt is for gold bought on that sale; the
-- sale's client must match.
create or replace function public.create_custody(
  p_client_id uuid, p_items jsonb, p_sale_id uuid default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_year int := extract(year from public.shop_today())::int;
  v_no int;
  v_receipt text;
  v_row jsonb;
  v_i int := 0;
begin
  perform public.require_active_user();
  if not exists (select 1 from public.clients where id = p_client_id and not archived) then
    raise exception 'NOT_FOUND: client' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION: list at least one item being kept' using errcode = '22023';
  end if;
  if p_sale_id is not null and not exists (
    select 1 from public.sales where id = p_sale_id and status = 'completed' and client_id = p_client_id
  ) then
    raise exception 'VALIDATION: that sale is not a completed sale for this client' using errcode = '22023';
  end if;

  insert into public.custody_counters as c (year, last_no) values (v_year, 1)
  on conflict (year) do update set last_no = c.last_no + 1 returning last_no into v_no;
  v_receipt := 'AMN-' || v_year || '-' || lpad(v_no::text, 5, '0');

  insert into public.custody_receipts (id, receipt_no, client_id, sale_id, note, received_by)
  values (v_id, v_receipt, p_client_id, p_sale_id, nullif(btrim(p_note), ''), v_uid);

  for v_row in select * from jsonb_array_elements(p_items) loop
    v_i := v_i + 1;
    insert into public.custody_items (receipt_id, description, metal, purity, qty, gross_weight_g, item_id, sort_order)
    values (v_id, btrim(v_row ->> 'description'), coalesce(v_row ->> 'metal', 'gold'),
            nullif(upper(v_row ->> 'purity'), ''), coalesce((v_row ->> 'qty')::int, 1),
            (v_row ->> 'gross_weight_g')::numeric, (v_row ->> 'item_id')::uuid, v_i);
  end loop;

  return jsonb_build_object('receipt_id', v_id, 'receipt_no', v_receipt);
end $$;
grant execute on function public.create_custody(uuid, jsonb, uuid, text) to authenticated;

-- Release: the receipt number presented by the client must match. Any active
-- user may release (an owner isn't always at the counter); who, when and to
-- whom is recorded permanently.
create or replace function public.release_custody(
  p_receipt_id uuid, p_presented_receipt_no text, p_returned_to text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.custody_receipts;
begin
  perform public.require_active_user();
  select * into v from public.custody_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'NOT_FOUND: receipt' using errcode = 'P0002';
  end if;
  if v.status <> 'held' then
    raise exception 'VALIDATION: this gold was already returned on %', to_char(v.returned_at, 'DD Mon YYYY') using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_presented_receipt_no, ''))) <> v.receipt_no then
    raise exception 'VALIDATION: receipt number does not match — ask for the original receipt' using errcode = '22023';
  end if;
  update public.custody_receipts
    set status = 'returned', returned_by = (select auth.uid()), returned_at = now(),
        returned_to = nullif(btrim(p_returned_to), ''), returned_note = nullif(btrim(p_note), '')
    where id = p_receipt_id;
  return jsonb_build_object('receipt_id', p_receipt_id, 'status', 'returned');
end $$;
grant execute on function public.release_custody(uuid, text, text, text) to authenticated;

-- Totals for the dashboard: what we are holding for clients.
create or replace function public.custody_summary()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'receipts_held', (select count(*) from public.custody_receipts where status = 'held'),
    'by_purity', coalesce((
      select jsonb_agg(jsonb_build_object('metal', metal, 'purity', purity, 'weight_g', w) order by metal, purity)
      from (select ci.metal, coalesce(ci.purity, '—') purity, sum(ci.gross_weight_g * ci.qty) w
            from public.custody_items ci join public.custody_receipts r on r.id = ci.receipt_id
            where r.status = 'held' and ci.gross_weight_g is not null
            group by ci.metal, coalesce(ci.purity, '—')) x
    ), '[]'::jsonb)
  ) where public.is_active_user();
$$;
grant execute on function public.custody_summary() to authenticated;
