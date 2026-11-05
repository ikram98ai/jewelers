-- =============================================================================
-- Sales, payments, old-gold exchange, balances, void.
-- Design: FR-4; decision "Sales: atomic invoice RPC, split/partial payments incl.
-- old gold, void instead of delete".
--
-- Invariants:
--   * A sale and everything it touches (lines, payments, items, stock moves) is
--     written in ONE transaction by create_sale().
--   * Piece items are row-locked (in id order, so no deadlocks) and must be
--     in_stock: two devices can never sell the same piece.
--   * Sales are never edited or deleted: void_sale() (admin) reverses stock.
--   * Lines snapshot weight, purity, rate, making and prices, so old invoices
--     never change when rates or items change.
-- =============================================================================

create table public.invoice_counters (
  year     int primary key,
  last_no  int not null
);
alter table public.invoice_counters enable row level security;  -- no policies: internal only

create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  invoice_no      text not null unique,
  client_id       uuid references public.clients (id),
  sold_by         uuid not null references public.profiles (id),
  subtotal        numeric(14, 2) not null default 0,   -- sum of suggested prices
  discount_total  numeric(14, 2) not null default 0,   -- subtotal - total
  total           numeric(14, 2) not null default 0 check (total >= 0),
  note            text check (note is null or length(note) <= 1000),
  status          text not null default 'completed' check (status in ('completed', 'void')),
  void_reason     text,
  voided_by       uuid references public.profiles (id),
  voided_at       timestamptz,
  created_at      timestamptz not null default now(),
  constraint sales_void_fields check (
    (status = 'void') = (voided_at is not null and voided_by is not null and void_reason is not null)
  )
);
create index sales_created_idx on public.sales (created_at desc);
create index sales_client_idx  on public.sales (client_id, created_at desc);
create index sales_sold_by_idx on public.sales (sold_by, created_at desc);

create table public.sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales (id) on delete restrict,
  item_id          uuid not null references public.items (id) on delete restrict,
  qty              int  not null default 1 check (qty >= 1),
  -- snapshots
  item_tag         text not null,
  item_name        text not null,
  metal            text not null,
  purity           text,
  net_weight_g     numeric(10, 3),
  rate_per_g       numeric(12, 2),
  making_amount    numeric(12, 2) not null default 0,
  stone_amount     numeric(12, 2) not null default 0,
  suggested_price  numeric(14, 2) not null,
  final_price      numeric(14, 2) not null check (final_price >= 0),
  created_at       timestamptz not null default now()
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_item_idx on public.sale_items (item_id);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales (id) on delete restrict,
  client_id    uuid references public.clients (id),
  method       text not null check (method in ('cash', 'card', 'bank_transfer', 'old_gold', 'other')),
  amount       numeric(14, 2) not null check (amount > 0),
  reference    text check (reference is null or length(reference) <= 200),
  received_by  uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index payments_sale_idx    on public.payments (sale_id);
create index payments_client_idx  on public.payments (client_id, created_at desc);
create index payments_created_idx on public.payments (created_at desc);

create table public.old_gold_receipts (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null unique references public.payments (id) on delete restrict,
  description     text,
  gross_weight_g  numeric(10, 3) not null check (gross_weight_g > 0),
  purity          text not null check (purity ~ '^[0-9]{2,3}K?$'),
  rate_per_g      numeric(12, 2) not null check (rate_per_g > 0),
  deduction_pct   numeric(5, 2) not null default 0 check (deduction_pct between 0 and 50),
  value           numeric(14, 2) not null check (value > 0)
);

alter table public.stock_moves
  add constraint stock_moves_sale_fk foreign key (sale_id) references public.sales (id);

-- Immutability
create trigger sale_items_append_only before update or delete on public.sale_items
  for each row execute function public.prevent_update_delete();
create trigger payments_append_only before update or delete on public.payments
  for each row execute function public.prevent_update_delete();
create trigger old_gold_append_only before update or delete on public.old_gold_receipts
  for each row execute function public.prevent_update_delete();

create or replace function public.sales_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'sales cannot be deleted; void instead' using errcode = 'P0001';
  end if;
  if old.status = 'void' then
    raise exception 'a void sale cannot be changed' using errcode = 'P0001';
  end if;
  if new.invoice_no <> old.invoice_no or new.client_id is distinct from old.client_id
     or new.sold_by <> old.sold_by or new.created_at <> old.created_at then
    raise exception 'sale identity fields are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sales_guard before update or delete on public.sales
  for each row execute function public.sales_guard();

create trigger audit after insert or update on public.sales
  for each row execute function public.audit_row('id');
create trigger audit after insert on public.payments
  for each row execute function public.audit_row('id');

-- RLS: everyone signed in can read; nobody writes directly.
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.old_gold_receipts enable row level security;
create policy sales_select on public.sales for select to authenticated using (public.is_active_user());
create policy sale_items_select on public.sale_items for select to authenticated using (public.is_active_user());
create policy payments_select on public.payments for select to authenticated using (public.is_active_user());
create policy old_gold_select on public.old_gold_receipts for select to authenticated using (public.is_active_user());
grant select on public.sales, public.sale_items, public.payments, public.old_gold_receipts to authenticated;

-- -----------------------------------------------------------------------------
-- Balances (security_invoker so the caller's RLS applies).
-- -----------------------------------------------------------------------------
create view public.sale_balances with (security_invoker = true) as
select s.id as sale_id,
       s.client_id,
       s.status,
       s.total,
       coalesce(p.paid, 0) as paid,
       case when s.status = 'void' then 0 else s.total - coalesce(p.paid, 0) end as balance
from public.sales s
left join (select sale_id, sum(amount) as paid from public.payments group by sale_id) p on p.sale_id = s.id;

create view public.client_balances with (security_invoker = true) as
select c.id as client_id,
       coalesce(sum(b.total), 0)   as total_purchases,
       coalesce(sum(b.paid), 0)    as total_paid,
       coalesce(sum(b.balance), 0) as balance,
       max(s.created_at)           as last_purchase_at
from public.clients c
left join public.sale_balances b on b.client_id = c.id and b.status = 'completed'
left join public.sales s on s.id = b.sale_id
group by c.id;

grant select on public.sale_balances, public.client_balances to authenticated;

-- Now that balances exist: a client who owes money cannot be archived.
create or replace function public.clients_archive_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.archived is distinct from old.archived then
    if (select auth.uid()) is not null and not public.is_admin() then
      raise exception 'ADMIN_ONLY: only an admin can archive clients' using errcode = '42501';
    end if;
    if new.archived and exists (
      select 1 from public.sale_balances b
      where b.client_id = new.id and b.status = 'completed' and b.balance > 0
    ) then
      raise exception 'VALIDATION: client has a balance due' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Internal: record one payment row (+ old gold detail). Not callable by clients.
-- Old gold value is computed here, never trusted from the browser:
--   value = round(weight * rate * (1 - deduction% / 100))
-- -----------------------------------------------------------------------------
create or replace function public._record_payment(p_sale_id uuid, p_client_id uuid, p jsonb, p_uid uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_method text := p ->> 'method';
  v_amount numeric;
  v_payment_id uuid;
  v_og jsonb := p -> 'old_gold';
  v_weight numeric;
  v_rate numeric;
  v_deduction numeric;
begin
  if v_method is null or v_method not in ('cash', 'card', 'bank_transfer', 'old_gold', 'other') then
    raise exception 'VALIDATION: unknown payment method' using errcode = '22023';
  end if;

  if v_method = 'old_gold' then
    if v_og is null then
      raise exception 'VALIDATION: old gold details required' using errcode = '22023';
    end if;
    v_weight := (v_og ->> 'gross_weight_g')::numeric;
    v_rate := (v_og ->> 'rate_per_g')::numeric;
    v_deduction := coalesce((v_og ->> 'deduction_pct')::numeric,
                            (select old_gold_deduction_pct from public.shop_settings where id = 1));
    if v_weight is null or v_weight <= 0 or v_rate is null or v_rate <= 0 or v_deduction < 0 or v_deduction > 50 then
      raise exception 'VALIDATION: invalid old gold weight, rate or deduction' using errcode = '22023';
    end if;
    v_amount := round(v_weight * v_rate * (1 - v_deduction / 100), 0);
  else
    v_amount := round((p ->> 'amount')::numeric, 2);
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'VALIDATION: payment amount must be positive' using errcode = '22023';
  end if;

  insert into public.payments (sale_id, client_id, method, amount, reference, received_by)
  values (p_sale_id, p_client_id, v_method, v_amount, nullif(btrim(p ->> 'reference'), ''), p_uid)
  returning id into v_payment_id;

  if v_method = 'old_gold' then
    insert into public.old_gold_receipts (payment_id, description, gross_weight_g, purity, rate_per_g, deduction_pct, value)
    values (v_payment_id, nullif(btrim(v_og ->> 'description'), ''), v_weight,
            upper(v_og ->> 'purity'), v_rate, v_deduction, v_amount);
  end if;

  return v_amount;
end $$;
revoke all on function public._record_payment(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_sale
--   p_lines:    [{ "item_id": uuid, "qty": 1, "final_price": 123000 }, ...]
--   p_payments: [{ "method": "cash", "amount": 100000, "reference": null },
--                { "method": "old_gold", "old_gold": { "gross_weight_g": 5.2,
--                  "purity": "22K", "rate_per_g": 21000, "deduction_pct": 2 } }]
-- -----------------------------------------------------------------------------
create or replace function public.create_sale(
  p_lines jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_client_id uuid default null,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale_id uuid := gen_random_uuid();
  v_line jsonb;
  v_pay jsonb;
  v_item public.items;
  v_qty int;
  v_unit numeric;
  v_suggested numeric;
  v_final numeric;
  v_rate numeric;
  v_making numeric;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_year int;
  v_no int;
  v_prefix text;
  v_invoice text;
begin
  perform public.require_active_user();

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VALIDATION: a sale needs at least one item' using errcode = '22023';
  end if;
  if p_payments is null then
    p_payments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'VALIDATION: payments must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    group by l ->> 'item_id' having count(*) > 1
  ) then
    raise exception 'VALIDATION: the same item appears twice' using errcode = '22023';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients where id = p_client_id and not archived
  ) then
    raise exception 'NOT_FOUND: client' using errcode = 'P0002';
  end if;

  -- Lock all items up front, in a stable order.
  perform 1 from public.items
  where id in (select (l ->> 'item_id')::uuid from jsonb_array_elements(p_lines) l)
  order by id
  for update;

  -- Gap-free invoice number per year (the counter row lock serializes this).
  v_year := extract(year from public.shop_today())::int;
  insert into public.invoice_counters as ic (year, last_no) values (v_year, 1)
  on conflict (year) do update set last_no = ic.last_no + 1
  returning last_no into v_no;
  select invoice_prefix into v_prefix from public.shop_settings where id = 1;
  v_invoice := v_prefix || '-' || v_year || '-' || lpad(v_no::text, 5, '0');

  insert into public.sales (id, invoice_no, client_id, sold_by, note)
  values (v_sale_id, v_invoice, p_client_id, v_uid, nullif(btrim(p_note), ''));

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.items where id = (v_line ->> 'item_id')::uuid;
    if not found then
      raise exception 'NOT_FOUND: item %', v_line ->> 'item_id' using errcode = 'P0002';
    end if;
    v_qty := coalesce((v_line ->> 'qty')::int, 1);
    if v_qty < 1 then
      raise exception 'VALIDATION: quantity must be at least 1' using errcode = '22023';
    end if;

    if v_item.tracking = 'piece' then
      if v_qty <> 1 or v_item.status <> 'in_stock' then
        raise exception 'ITEM_UNAVAILABLE: % is no longer in stock', v_item.tag using errcode = 'P0001';
      end if;
    elsif v_item.archived or v_item.qty_on_hand < v_qty then
      raise exception 'ITEM_UNAVAILABLE: only % of % left', v_item.qty_on_hand, v_item.tag using errcode = 'P0001';
    end if;

    v_unit := public.suggested_price(v_item);
    if v_unit is null then
      raise exception 'RATE_MISSING: no rate set for % %', v_item.metal, v_item.purity using errcode = 'P0001';
    end if;
    v_suggested := v_unit * v_qty;
    v_final := round((v_line ->> 'final_price')::numeric, 0);
    if v_final is null or v_final < 0 then
      raise exception 'VALIDATION: final price is required for %', v_item.tag using errcode = '22023';
    end if;

    if v_item.fixed_price is null then
      v_rate := public.current_rate(v_item.metal, v_item.purity);
      v_making := case v_item.making_type when 'fixed' then v_item.making_charge
                  else round(v_item.making_charge * v_item.net_weight_g, 2) end;
    else
      v_rate := null;
      v_making := 0;
    end if;

    insert into public.sale_items (
      sale_id, item_id, qty, item_tag, item_name, metal, purity, net_weight_g,
      rate_per_g, making_amount, stone_amount, suggested_price, final_price
    ) values (
      v_sale_id, v_item.id, v_qty, v_item.tag, v_item.name, v_item.metal, v_item.purity,
      v_item.net_weight_g, v_rate, v_making,
      case when v_item.fixed_price is null then v_item.stone_charge else 0 end,
      v_suggested, v_final
    );

    if v_item.tracking = 'piece' then
      update public.items set status = 'sold', qty_on_hand = 0 where id = v_item.id;
    else
      update public.items set qty_on_hand = qty_on_hand - v_qty where id = v_item.id;
    end if;

    insert into public.stock_moves (item_id, type, qty, sale_id, created_by)
    values (v_item.id, 'sale', -v_qty, v_sale_id, v_uid);

    v_subtotal := v_subtotal + v_suggested;
    v_total := v_total + v_final;
  end loop;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_paid := v_paid + public._record_payment(v_sale_id, p_client_id, v_pay, v_uid);
  end loop;

  if v_paid > v_total then
    raise exception 'OVERPAID: payments (%) exceed the total (%)', v_paid, v_total using errcode = 'P0001';
  end if;
  if p_client_id is null and v_paid < v_total then
    raise exception 'CREDIT_NEEDS_CLIENT: choose a client to leave a balance due' using errcode = 'P0001';
  end if;

  update public.sales
    set subtotal = v_subtotal, total = v_total, discount_total = v_subtotal - v_total
    where id = v_sale_id;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'invoice_no', v_invoice,
    'total', v_total, 'paid', v_paid, 'balance', v_total - v_paid
  );
end $$;
grant execute on function public.create_sale(jsonb, jsonb, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- add_payment: a later payment against a sale with a balance due.
-- -----------------------------------------------------------------------------
create or replace function public.add_payment(p_sale_id uuid, p_payment jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale public.sales;
  v_paid numeric;
  v_amount numeric;
  v_balance numeric;
begin
  perform public.require_active_user();
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'NOT_FOUND: sale' using errcode = 'P0002';
  end if;
  if v_sale.status = 'void' then
    raise exception 'SALE_VOID: this sale was voided' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where sale_id = p_sale_id;
  v_amount := public._record_payment(p_sale_id, v_sale.client_id, p_payment, v_uid);
  v_balance := v_sale.total - v_paid - v_amount;
  if v_balance < 0 then
    raise exception 'OVERPAID: only % is due', v_sale.total - v_paid using errcode = 'P0001';
  end if;

  return jsonb_build_object('sale_id', p_sale_id, 'amount', v_amount, 'sale_balance', v_balance);
end $$;
grant execute on function public.add_payment(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- void_sale (admin): reverse stock; payments stay recorded but the sale's
-- balance becomes 0 and it drops out of totals. Refunds go in the reason.
-- -----------------------------------------------------------------------------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale public.sales;
  v_line record;
begin
  perform public.require_admin();
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'VALIDATION: a reason of at least 5 characters is required' using errcode = '22023';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'NOT_FOUND: sale' using errcode = 'P0002';
  end if;
  if v_sale.status = 'void' then
    raise exception 'ALREADY_VOID' using errcode = 'P0001';
  end if;

  perform 1 from public.items
  where id in (select item_id from public.sale_items where sale_id = p_sale_id)
  order by id for update;

  for v_line in
    select si.item_id, si.qty, i.tracking, i.status
    from public.sale_items si join public.items i on i.id = si.item_id
    where si.sale_id = p_sale_id
  loop
    if v_line.tracking = 'piece' then
      if v_line.status <> 'sold' then
        raise exception 'VALIDATION: item state changed since the sale' using errcode = '22023';
      end if;
      update public.items set status = 'in_stock', qty_on_hand = 1 where id = v_line.item_id;
    else
      update public.items set qty_on_hand = qty_on_hand + v_line.qty, archived = false where id = v_line.item_id;
    end if;
    insert into public.stock_moves (item_id, type, qty, reason, sale_id, created_by)
    values (v_line.item_id, 'void_return', v_line.qty, btrim(p_reason), p_sale_id, v_uid);
  end loop;

  update public.sales
    set status = 'void', void_reason = btrim(p_reason), voided_by = v_uid, voided_at = now()
    where id = p_sale_id;

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'void');
end $$;
grant execute on function public.void_sale(uuid, text) to authenticated;
