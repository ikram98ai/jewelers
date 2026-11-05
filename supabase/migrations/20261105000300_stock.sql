-- =============================================================================
-- Stock: items (piece | bulk), admin-only costs, photos, append-only stock moves.
-- Design: FR-2; decisions "Stock model", "Cost prices in an admin-only table",
-- "Stock integrity: append-only stock moves, RPC-only writes".
--
-- status / qty_on_hand / tag / tracking are never writable by clients. They are
-- changed only by receive_stock, adjust_stock, create_sale and void_sale.
-- =============================================================================

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  tracking        text not null check (tracking in ('piece', 'bulk')),
  tag             text not null unique,
  legacy_tag      text,
  category_id     uuid not null references public.categories (id),
  name            text not null check (length(btrim(name)) between 1 and 120),
  description     text check (description is null or length(description) <= 2000),
  metal           text not null check (metal in ('gold', 'silver', 'platinum', 'other')),
  purity          text check (purity is null or purity ~ '^[0-9]{2,3}K?$'),
  gross_weight_g  numeric(10, 3) check (gross_weight_g is null or gross_weight_g > 0),
  stone_weight_g  numeric(10, 3) not null default 0 check (stone_weight_g >= 0),
  net_weight_g    numeric(10, 3) generated always as (gross_weight_g - stone_weight_g) stored,
  making_type     text not null default 'per_gram' check (making_type in ('per_gram', 'fixed')),
  making_charge   numeric(12, 2) not null default 0 check (making_charge >= 0),
  stone_charge    numeric(12, 2) not null default 0 check (stone_charge >= 0),
  fixed_price     numeric(12, 2) check (fixed_price is null or fixed_price >= 0),
  qty_on_hand     int not null default 0 check (qty_on_hand >= 0),
  low_stock_at    int check (low_stock_at is null or low_stock_at >= 0),
  status          text not null default 'in_stock' check (status in ('in_stock', 'sold', 'written_off')),
  archived        boolean not null default false,
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint items_stone_le_gross check (gross_weight_g is null or stone_weight_g <= gross_weight_g),
  constraint items_piece_qty check (tracking = 'bulk' or qty_on_hand in (0, 1)),
  constraint items_piece_status_qty check (tracking = 'bulk' or ((status = 'in_stock') = (qty_on_hand = 1))),
  constraint items_bulk_status check (tracking = 'piece' or status = 'in_stock'),
  constraint items_bulk_price check (tracking = 'piece' or fixed_price is not null),
  -- A rate-priced item needs a purity and a weight; otherwise it needs a fixed price.
  constraint items_priceable check (
    fixed_price is not null or (metal <> 'other' and purity is not null and gross_weight_g is not null)
  )
);
create index items_status_category_idx on public.items (status, category_id) where not archived;
create index items_name_trgm_idx  on public.items using gin (name extensions.gin_trgm_ops);
create index items_tag_trgm_idx   on public.items using gin (tag extensions.gin_trgm_ops);
create index items_legacy_tag_idx on public.items (legacy_tag) where legacy_tag is not null;
create index items_net_weight_idx on public.items (net_weight_g);

create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();
create trigger audit after insert or update on public.items
  for each row execute function public.audit_row('id');

-- Tag = <category prefix>-<5-digit sequence>. The UPDATE ... RETURNING takes a
-- row lock on the category, so concurrent inserts never get the same number.
create or replace function public.items_assign_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text;
  v_seq int;
begin
  if new.tag is null then
    update public.categories c set next_seq = c.next_seq + 1
    where c.id = new.category_id
    returning c.tag_prefix, c.next_seq - 1 into v_prefix, v_seq;
    if v_prefix is null then
      raise exception 'VALIDATION: unknown category' using errcode = '22023';
    end if;
    new.tag := v_prefix || '-' || lpad(v_seq::text, 5, '0');
  end if;
  return new;
end $$;
create trigger items_assign_tag before insert on public.items
  for each row execute function public.items_assign_tag();

alter table public.items enable row level security;
create policy items_select on public.items
  for select to authenticated using (public.is_active_user());
-- Admin may edit descriptive/pricing fields directly (column grants below).
create policy items_update on public.items
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.items to authenticated;
grant update (category_id, name, description, metal, purity, gross_weight_g, stone_weight_g,
              making_type, making_charge, stone_charge, fixed_price, low_stock_at, legacy_tag)
  on public.items to authenticated;

-- PostgREST computed column: GET /items?select=*,suggested_price
create or replace function public.suggested_price(i public.items)
returns numeric language sql stable security definer set search_path = '' as $$
  select public.price_for(i.metal, i.purity, i.net_weight_g, i.making_type,
                          i.making_charge, i.stone_charge, i.fixed_price);
$$;
grant execute on function public.suggested_price(public.items) to authenticated;

-- -----------------------------------------------------------------------------
-- Costs: admin only.
-- -----------------------------------------------------------------------------
create table public.item_costs (
  item_id        uuid primary key references public.items (id) on delete restrict,
  cost_amount    numeric(12, 2) not null check (cost_amount >= 0),
  supplier       text,
  purchase_date  date,
  notes          text,
  updated_at     timestamptz not null default now()
);
create trigger item_costs_updated_at before update on public.item_costs
  for each row execute function public.set_updated_at();
create trigger audit after insert or update on public.item_costs
  for each row execute function public.audit_row('item_id');

alter table public.item_costs enable row level security;
create policy item_costs_admin on public.item_costs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.item_costs to authenticated;

-- -----------------------------------------------------------------------------
-- Photos: files live in the private `item-photos` bucket under <item_id>/.
-- -----------------------------------------------------------------------------
create table public.item_photos (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items (id) on delete restrict,
  storage_path  text not null unique,
  sort_order    int not null default 0,
  created_by    uuid not null references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint item_photos_path check (storage_path like item_id::text || '/%')
);
create index item_photos_item_idx on public.item_photos (item_id, sort_order);

create or replace function public.item_photos_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.item_photos where item_id = new.item_id) >= 4 then
    raise exception 'VALIDATION: an item can have at most 4 photos' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger item_photos_limit before insert on public.item_photos
  for each row execute function public.item_photos_limit();

alter table public.item_photos enable row level security;
create policy item_photos_select on public.item_photos
  for select to authenticated using (public.is_active_user());
create policy item_photos_insert on public.item_photos
  for insert to authenticated with check (public.is_active_user() and created_by = (select auth.uid()));
create policy item_photos_delete on public.item_photos
  for delete to authenticated using (public.is_admin());
grant select, delete on public.item_photos to authenticated;
grant insert (item_id, storage_path, sort_order) on public.item_photos to authenticated;

-- -----------------------------------------------------------------------------
-- Stock moves: the append-only ledger. sum(qty) per item = qty_on_hand.
-- -----------------------------------------------------------------------------
create table public.stock_moves (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references public.items (id) on delete restrict,
  type        text not null check (type in ('receive', 'sale', 'void_return', 'adjust', 'write_off', 'restore')),
  qty         int  not null check (qty <> 0),
  reason      text,
  sale_id     uuid,  -- FK added in the sales migration
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  constraint stock_moves_reason check (type not in ('adjust', 'write_off', 'restore') or length(btrim(reason)) >= 3)
);
create index stock_moves_item_idx on public.stock_moves (item_id, created_at desc);
create trigger stock_moves_append_only before update or delete on public.stock_moves
  for each row execute function public.prevent_update_delete();

alter table public.stock_moves enable row level security;
create policy stock_moves_select on public.stock_moves
  for select to authenticated using (public.is_active_user());
grant select on public.stock_moves to authenticated;

-- -----------------------------------------------------------------------------
-- Search. SECURITY INVOKER so RLS applies. Matches tag, legacy tag, name, or a
-- net weight within ±0.05 g when the query is a number.
-- -----------------------------------------------------------------------------

-- Never throws. A bare `text::numeric` inside an inlined SQL function can be
-- constant-folded at plan time and fail for queries like 'ring', even behind
-- an AND guard, so search uses this instead.
create or replace function public.try_numeric(p text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  return p::numeric;
exception when others then
  return null;
end $$;
grant execute on function public.try_numeric(text) to authenticated;

create or replace function public.search_items(
  p_q text default null,
  p_category_id uuid default null,
  p_metal text default null,
  p_status text default 'in_stock',
  p_tracking text default null,
  p_include_archived boolean default false
) returns setof public.items language sql stable set search_path = '' as $$
  select i.*
  from public.items i
  where (p_category_id is null or i.category_id = p_category_id)
    and (p_metal is null or i.metal = p_metal)
    and (p_status is null or i.status = p_status)
    and (p_tracking is null or i.tracking = p_tracking)
    and (p_include_archived or not i.archived)
    and (
      p_q is null or btrim(p_q) = ''
      or i.tag ilike '%' || btrim(p_q) || '%'
      or i.legacy_tag ilike btrim(p_q)
      or i.name ilike '%' || btrim(p_q) || '%'
      or i.net_weight_g between public.try_numeric(btrim(p_q)) - 0.05
                            and public.try_numeric(btrim(p_q)) + 0.05
    )
  order by i.created_at desc;
$$;
grant execute on function public.search_items(text, uuid, text, text, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- receive_stock: create a new item (piece or bulk) or restock a bulk item.
--   New:     receive_stock(p_item => {...}, p_qty => n, p_cost => {...})
--   Restock: receive_stock(p_item_id => '...', p_qty => n)
-- Cost is saved only when the caller is an admin (silently ignored otherwise).
-- -----------------------------------------------------------------------------
create or replace function public.receive_stock(
  p_item jsonb default null,
  p_item_id uuid default null,
  p_qty int default 1,
  p_cost jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.items;
  v_tracking text;
begin
  perform public.require_active_user();
  if p_qty is null or p_qty < 1 then
    raise exception 'VALIDATION: quantity must be at least 1' using errcode = '22023';
  end if;

  if p_item_id is not null then
    -- Restock an existing bulk item.
    select * into v_item from public.items where id = p_item_id for update;
    if not found then
      raise exception 'NOT_FOUND: item' using errcode = 'P0002';
    end if;
    if v_item.tracking <> 'bulk' then
      raise exception 'VALIDATION: only bulk items can be restocked' using errcode = '22023';
    end if;
    update public.items set qty_on_hand = qty_on_hand + p_qty, archived = false
      where id = p_item_id returning * into v_item;
  else
    if p_item is null then
      raise exception 'VALIDATION: item details required' using errcode = '22023';
    end if;
    v_tracking := coalesce(p_item ->> 'tracking', 'piece');
    if v_tracking = 'piece' and p_qty <> 1 then
      raise exception 'VALIDATION: a piece item has quantity 1' using errcode = '22023';
    end if;

    insert into public.items (
      tracking, legacy_tag, category_id, name, description, metal, purity,
      gross_weight_g, stone_weight_g, making_type, making_charge, stone_charge,
      fixed_price, low_stock_at, qty_on_hand, status, created_by
    ) values (
      v_tracking,
      nullif(btrim(p_item ->> 'legacy_tag'), ''),
      (p_item ->> 'category_id')::uuid,
      btrim(p_item ->> 'name'),
      nullif(btrim(p_item ->> 'description'), ''),
      coalesce(p_item ->> 'metal', 'gold'),
      nullif(upper(p_item ->> 'purity'), ''),
      (p_item ->> 'gross_weight_g')::numeric,
      coalesce((p_item ->> 'stone_weight_g')::numeric, 0),
      coalesce(p_item ->> 'making_type', 'per_gram'),
      coalesce((p_item ->> 'making_charge')::numeric, 0),
      coalesce((p_item ->> 'stone_charge')::numeric, 0),
      (p_item ->> 'fixed_price')::numeric,
      (p_item ->> 'low_stock_at')::int,
      p_qty,
      'in_stock',
      v_uid
    ) returning * into v_item;
  end if;

  insert into public.stock_moves (item_id, type, qty, created_by)
  values (v_item.id, 'receive', p_qty, v_uid);

  if p_cost is not null and public.is_admin() and (p_cost ->> 'cost_amount') is not null then
    insert into public.item_costs (item_id, cost_amount, supplier, purchase_date, notes)
    values (
      v_item.id,
      (p_cost ->> 'cost_amount')::numeric,
      nullif(btrim(p_cost ->> 'supplier'), ''),
      (p_cost ->> 'purchase_date')::date,
      nullif(btrim(p_cost ->> 'notes'), '')
    )
    on conflict (item_id) do update
      set cost_amount = excluded.cost_amount,
          supplier = coalesce(excluded.supplier, public.item_costs.supplier),
          purchase_date = coalesce(excluded.purchase_date, public.item_costs.purchase_date),
          notes = coalesce(excluded.notes, public.item_costs.notes);
  end if;

  return jsonb_build_object('item_id', v_item.id, 'tag', v_item.tag, 'qty_on_hand', v_item.qty_on_hand);
end $$;
grant execute on function public.receive_stock(jsonb, uuid, int, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- adjust_stock (admin): every non-sale correction, always with a reason.
--   adjust     bulk qty +/- p_qty_delta
--   write_off  piece in_stock -> written_off; bulk qty - p_qty_delta
--   restore    written-off piece found again -> in_stock
--   archive / unarchive  hide or show in default lists (bulk must be at qty 0;
--              pieces must not be in stock)
-- -----------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_item_id uuid,
  p_type text,
  p_reason text,
  p_qty_delta int default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.items;
  v_delta int;
begin
  perform public.require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'VALIDATION: a reason is required' using errcode = '22023';
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception 'NOT_FOUND: item' using errcode = 'P0002';
  end if;

  case p_type
    when 'adjust' then
      if v_item.tracking <> 'bulk' then
        raise exception 'VALIDATION: use write off / restore for piece items' using errcode = '22023';
      end if;
      if coalesce(p_qty_delta, 0) = 0 then
        raise exception 'VALIDATION: quantity change required' using errcode = '22023';
      end if;
      if v_item.qty_on_hand + p_qty_delta < 0 then
        raise exception 'VALIDATION: quantity cannot go below zero' using errcode = '22023';
      end if;
      v_delta := p_qty_delta;
      update public.items set qty_on_hand = qty_on_hand + v_delta where id = p_item_id returning * into v_item;

    when 'write_off' then
      if v_item.tracking = 'piece' then
        if v_item.status <> 'in_stock' then
          raise exception 'VALIDATION: only an in-stock piece can be written off' using errcode = '22023';
        end if;
        v_delta := -1;
        update public.items set status = 'written_off', qty_on_hand = 0 where id = p_item_id returning * into v_item;
      else
        v_delta := -abs(coalesce(p_qty_delta, 0));
        if v_delta = 0 or v_item.qty_on_hand + v_delta < 0 then
          raise exception 'VALIDATION: invalid write-off quantity' using errcode = '22023';
        end if;
        update public.items set qty_on_hand = qty_on_hand + v_delta where id = p_item_id returning * into v_item;
      end if;

    when 'restore' then
      if v_item.tracking <> 'piece' or v_item.status <> 'written_off' then
        raise exception 'VALIDATION: only a written-off piece can be restored' using errcode = '22023';
      end if;
      v_delta := 1;
      update public.items set status = 'in_stock', qty_on_hand = 1 where id = p_item_id returning * into v_item;

    when 'archive', 'unarchive' then
      if p_type = 'archive' and v_item.qty_on_hand > 0 then
        raise exception 'VALIDATION: only items with no stock on hand can be archived' using errcode = '22023';
      end if;
      update public.items set archived = (p_type = 'archive') where id = p_item_id returning * into v_item;

    else
      raise exception 'VALIDATION: unknown adjustment type %', p_type using errcode = '22023';
  end case;

  if v_delta is not null then
    insert into public.stock_moves (item_id, type, qty, reason, created_by)
    values (p_item_id, p_type, v_delta, btrim(p_reason), v_uid);
  end if;

  return jsonb_build_object('item_id', v_item.id, 'status', v_item.status,
                            'qty_on_hand', v_item.qty_on_hand, 'archived', v_item.archived);
end $$;
grant execute on function public.adjust_stock(uuid, text, text, int) to authenticated;
