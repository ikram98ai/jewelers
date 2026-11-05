-- =============================================================================
-- 1. Buying from clients (used jewellery / sets / old gold): purchase vouchers.
--    Each line goes to stock (a new tagged item, cost = price paid) or to the
--    melt pile. Admin only: money leaves the shop.
-- 2. Returns & exchanges: return lines of a past sale (optionally minus a
--    deduction). The credit first settles anything still owed on that sale; the
--    rest is refunded (cash / bank) or kept as exchange credit that pays for a
--    new sale (payment method 'exchange', reference = return number).
-- =============================================================================

alter table public.stock_moves drop constraint stock_moves_type_check;
alter table public.stock_moves add constraint stock_moves_type_check
  check (type in ('receive', 'sale', 'void_return', 'adjust', 'write_off', 'restore', 'return', 'purchase'));

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'bank_transfer', 'old_gold', 'exchange', 'other'));

create table public.doc_counters (kind text, year int, last_no int not null, primary key (kind, year));
alter table public.doc_counters enable row level security;  -- internal only

create or replace function public._next_doc_no(p_kind text, p_prefix text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from public.shop_today())::int;
  v_no int;
begin
  insert into public.doc_counters as c (kind, year, last_no) values (p_kind, v_year, 1)
  on conflict (kind, year) do update set last_no = c.last_no + 1 returning last_no into v_no;
  return p_prefix || '-' || v_year || '-' || lpad(v_no::text, 5, '0');
end $$;
revoke all on function public._next_doc_no(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Purchases from clients
-- -----------------------------------------------------------------------------
create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  purchase_no     text not null unique,
  client_id       uuid not null references public.clients (id),
  seller_id_note  text check (seller_id_note is null or length(seller_id_note) <= 100),  -- e.g. CNIC seen
  total           numeric(14, 2) not null check (total >= 0),
  method          text not null check (method in ('cash', 'bank_transfer')),
  reference       text,
  note            text check (note is null or length(note) <= 1000),
  bought_by       uuid not null references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index purchases_created_idx on public.purchases (created_at desc);
create index purchases_client_idx on public.purchases (client_id, created_at desc);

create table public.purchase_items (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null references public.purchases (id) on delete restrict,
  description     text not null check (length(btrim(description)) between 1 and 200),
  metal           text not null check (metal in ('gold', 'silver', 'platinum', 'other')),
  purity          text check (purity is null or purity ~ '^[0-9]{2,3}K?$'),
  qty             int not null default 1 check (qty >= 1),
  gross_weight_g  numeric(10, 3) check (gross_weight_g is null or gross_weight_g > 0),
  stone_weight_g  numeric(10, 3) not null default 0 check (stone_weight_g >= 0),
  rate_per_g      numeric(12, 2),
  deduction_pct   numeric(5, 2) not null default 0 check (deduction_pct between 0 and 50),
  value           numeric(14, 2) not null check (value >= 0),
  destination     text not null check (destination in ('stock', 'melt')),
  item_id         uuid references public.items (id),
  sort_order      int not null default 0
);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id, sort_order);

-- Rows are written once. The creating function fills in its totals after the lines by
-- marking the row id in a transaction-local setting (clients cannot set it via the API).
create or replace function public.finalize_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows cannot be deleted', tg_table_name using errcode = 'P0001';
  end if;
  if current_setting('jewelers.finalize_id', true) = old.id::text then
    return new;
  end if;
  if tg_table_name = 'sale_returns'
     and (to_jsonb(new) - 'exchange_used') = (to_jsonb(old) - 'exchange_used') then
    return new;  -- spending exchange credit later is the only allowed change
  end if;
  raise exception '% rows are immutable', tg_table_name using errcode = 'P0001';
end $$;

create trigger purchases_guard before update or delete on public.purchases
  for each row execute function public.finalize_guard();
create trigger purchase_items_append_only before update or delete on public.purchase_items
  for each row execute function public.prevent_update_delete();
create trigger audit after insert on public.purchases
  for each row execute function public.audit_row('id');

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
create policy purchases_select on public.purchases for select to authenticated using (public.is_active_user());
create policy purchase_items_select on public.purchase_items for select to authenticated using (public.is_active_user());
grant select on public.purchases, public.purchase_items to authenticated;

-- p_lines: [{ "description", "metal", "purity", "qty", "gross_weight_g", "stone_weight_g",
--             "rate_per_g", "deduction_pct",          -- value = net × rate × (1 − deduction%)
--             "value",                                -- or an agreed amount (gems, artificial)
--             "destination": "stock"|"melt",
--             "category_id", "name", "making_type", "making_charge", "stone_charge", "fixed_price",  -- for stock
--             "components": [{ "kind", "description", "qty", "gross_weight_g" }] }]               -- for sets
create or replace function public.buy_from_client(
  p_client_id uuid, p_lines jsonb, p_method text default 'cash', p_reference text default null,
  p_seller_id_note text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_no text;
  v_line jsonb;
  v_i int := 0;
  v_net numeric; v_value numeric; v_total numeric := 0;
  v_item public.items;
  v_items jsonb := '[]';
  v_client_name text;
begin
  perform public.require_admin();
  select full_name into v_client_name from public.clients where id = p_client_id and not archived;
  if v_client_name is null then
    raise exception 'NOT_FOUND: client' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VALIDATION: add at least one piece' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'bank_transfer') then
    raise exception 'VALIDATION: pay by cash or bank transfer' using errcode = '22023';
  end if;

  v_no := public._next_doc_no('purchase', 'PUR');
  insert into public.purchases (id, purchase_no, client_id, seller_id_note, total, method, reference, note, bought_by)
  values (v_id, v_no, p_client_id, nullif(btrim(p_seller_id_note), ''), 0, p_method,
          nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), v_uid);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    v_net := (v_line ->> 'gross_weight_g')::numeric - coalesce((v_line ->> 'stone_weight_g')::numeric, 0);
    if (v_line ->> 'rate_per_g') is not null then
      if v_net is null or v_net <= 0 then
        raise exception 'VALIDATION: line %: weight is required to price by rate', v_i using errcode = '22023';
      end if;
      v_value := round(v_net * (v_line ->> 'rate_per_g')::numeric
                       * (1 - coalesce((v_line ->> 'deduction_pct')::numeric, 0) / 100)
                       * coalesce((v_line ->> 'qty')::int, 1), 0);
    else
      v_value := round((v_line ->> 'value')::numeric, 0);
    end if;
    if v_value is null or v_value < 0 then
      raise exception 'VALIDATION: line %: enter a rate or an agreed amount', v_i using errcode = '22023';
    end if;

    v_item := null;
    if coalesce(v_line ->> 'destination', 'stock') = 'stock' then
      insert into public.items (tracking, category_id, name, description, metal, purity, gross_weight_g, stone_weight_g,
                                making_type, making_charge, stone_charge, fixed_price, qty_on_hand, status, created_by)
      values ('piece', (v_line ->> 'category_id')::uuid,
              coalesce(nullif(btrim(v_line ->> 'name'), ''), btrim(v_line ->> 'description')),
              'Bought from ' || v_client_name || ' (' || v_no || ')',
              coalesce(v_line ->> 'metal', 'gold'), nullif(upper(v_line ->> 'purity'), ''),
              (v_line ->> 'gross_weight_g')::numeric, coalesce((v_line ->> 'stone_weight_g')::numeric, 0),
              coalesce(v_line ->> 'making_type', 'per_gram'), coalesce((v_line ->> 'making_charge')::numeric, 0),
              coalesce((v_line ->> 'stone_charge')::numeric, 0), (v_line ->> 'fixed_price')::numeric, 1, 'in_stock', v_uid)
      returning * into v_item;
      insert into public.stock_moves (item_id, type, qty, reason, created_by)
      values (v_item.id, 'purchase', 1, 'Bought from client, ' || v_no, v_uid);
      insert into public.item_costs (item_id, cost_amount, supplier, purchase_date)
      values (v_item.id, v_value, 'Client: ' || v_client_name, public.shop_today());
      insert into public.item_components (item_id, kind, description, qty, gross_weight_g, sort_order, created_by)
      select v_item.id, coalesce(c ->> 'kind', 'other'), c ->> 'description', coalesce((c ->> 'qty')::int, 1),
             (c ->> 'gross_weight_g')::numeric, ord::int, v_uid
      from jsonb_array_elements(coalesce(v_line -> 'components', '[]'::jsonb)) with ordinality as e(c, ord);
      v_items := v_items || jsonb_build_object('item_id', v_item.id, 'tag', v_item.tag);
    end if;

    insert into public.purchase_items (purchase_id, description, metal, purity, qty, gross_weight_g, stone_weight_g,
                                       rate_per_g, deduction_pct, value, destination, item_id, sort_order)
    values (v_id, btrim(v_line ->> 'description'), coalesce(v_line ->> 'metal', 'gold'), nullif(upper(v_line ->> 'purity'), ''),
            coalesce((v_line ->> 'qty')::int, 1), (v_line ->> 'gross_weight_g')::numeric,
            coalesce((v_line ->> 'stone_weight_g')::numeric, 0), (v_line ->> 'rate_per_g')::numeric,
            coalesce((v_line ->> 'deduction_pct')::numeric, 0), v_value,
            coalesce(v_line ->> 'destination', 'stock'), v_item.id, v_i);
    v_total := v_total + v_value;
  end loop;

  perform set_config('jewelers.finalize_id', v_id::text, true);
  update public.purchases set total = v_total where id = v_id;
  perform set_config('jewelers.finalize_id', '', true);

  return jsonb_build_object('purchase_id', v_id, 'purchase_no', v_no, 'total', v_total, 'items', v_items);
end $$;
grant execute on function public.buy_from_client(uuid, jsonb, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Returns & exchanges
-- -----------------------------------------------------------------------------
create table public.sale_returns (
  id               uuid primary key default gen_random_uuid(),
  return_no        text not null unique,
  sale_id          uuid not null references public.sales (id),
  client_id        uuid references public.clients (id),
  deduction_pct    numeric(5, 2) not null default 0 check (deduction_pct between 0 and 50),
  credit           numeric(14, 2) not null check (credit >= 0),      -- value given back for the returned lines
  applied_to_due   numeric(14, 2) not null default 0,                -- part that cancelled what was still owed
  settle           text not null check (settle in ('cash', 'bank_transfer', 'exchange', 'balance')),
  refund_amount    numeric(14, 2) not null default 0,                -- paid out as cash / bank
  exchange_amount  numeric(14, 2) not null default 0,                -- kept as credit for a new sale
  exchange_used    numeric(14, 2) not null default 0 check (exchange_used <= exchange_amount),
  reason           text not null check (length(btrim(reason)) >= 3),
  returned_by      uuid not null references public.profiles (id),
  created_at       timestamptz not null default now()
);
create index sale_returns_sale_idx on public.sale_returns (sale_id);

create table public.sale_return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references public.sale_returns (id) on delete restrict,
  sale_item_id  uuid not null references public.sale_items (id),
  item_id       uuid not null references public.items (id),
  qty           int not null check (qty >= 1),
  line_value    numeric(14, 2) not null,
  credit        numeric(14, 2) not null
);
create index sale_return_items_sale_item_idx on public.sale_return_items (sale_item_id);

create trigger sale_return_items_append_only before update or delete on public.sale_return_items
  for each row execute function public.prevent_update_delete();
create trigger sale_returns_guard before update or delete on public.sale_returns
  for each row execute function public.finalize_guard();
create trigger audit after insert or update on public.sale_returns
  for each row execute function public.audit_row('id');

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
create policy sale_returns_select on public.sale_returns for select to authenticated using (public.is_active_user());
create policy sale_return_items_select on public.sale_return_items for select to authenticated using (public.is_active_user());
grant select on public.sale_returns, public.sale_return_items to authenticated;

-- Balances now account for returns:
--   balance = total − credit returned − paid + paid back out (refund / exchange credit)
create or replace view public.sale_balances with (security_invoker = true) as
select s.id as sale_id,
       s.client_id,
       s.status,
       s.total,
       coalesce(p.paid, 0) as paid,
       case when s.status = 'void' then 0
            else s.total - coalesce(r.credit, 0) - coalesce(p.paid, 0) + coalesce(r.paid_out, 0) end as balance,
       coalesce(r.credit, 0) as returned_credit,
       coalesce(r.paid_out, 0) as paid_out
from public.sales s
left join (select sale_id, sum(amount) as paid from public.payments group by sale_id) p on p.sale_id = s.id
left join (select sale_id, sum(credit) as credit, sum(refund_amount + exchange_amount) as paid_out
           from public.sale_returns group by sale_id) r on r.sale_id = s.id;

-- p_lines: [{ "sale_item_id": uuid, "qty": 1 }, ...]
-- p_settle: how money still due TO the client leaves: cash | bank_transfer | exchange
create or replace function public.return_sale_items(
  p_sale_id uuid, p_lines jsonb, p_settle text, p_reason text, p_deduction_pct numeric default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale public.sales;
  v_id uuid := gen_random_uuid();
  v_no text;
  v_line jsonb;
  v_si public.sale_items;
  v_item public.items;
  v_qty int; v_already int; v_value numeric; v_credit numeric; v_total_credit numeric := 0;
  v_due numeric; v_applied numeric; v_out numeric;
  v_ded numeric := coalesce(p_deduction_pct, 0);
begin
  perform public.require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'VALIDATION: a reason is required' using errcode = '22023';
  end if;
  if p_settle not in ('cash', 'bank_transfer', 'exchange') then
    raise exception 'VALIDATION: refund by cash, bank transfer, or keep as exchange credit' using errcode = '22023';
  end if;
  if v_ded < 0 or v_ded > 50 then
    raise exception 'VALIDATION: deduction must be 0–50%%' using errcode = '22023';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'NOT_FOUND: sale' using errcode = 'P0002'; end if;
  if v_sale.status <> 'completed' then
    raise exception 'VALIDATION: only completed sales can be returned' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VALIDATION: choose what is being returned' using errcode = '22023';
  end if;

  select balance into v_due from public.sale_balances where sale_id = p_sale_id;
  v_no := public._next_doc_no('return', 'RET');
  insert into public.sale_returns (id, return_no, sale_id, client_id, deduction_pct, credit, settle, reason, returned_by)
  values (v_id, v_no, p_sale_id, v_sale.client_id, v_ded, 0, p_settle, btrim(p_reason), v_uid);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_si from public.sale_items where id = (v_line ->> 'sale_item_id')::uuid and sale_id = p_sale_id;
    if not found then raise exception 'VALIDATION: that line is not on this sale' using errcode = '22023'; end if;
    v_qty := coalesce((v_line ->> 'qty')::int, v_si.qty);
    select coalesce(sum(qty), 0) into v_already from public.sale_return_items where sale_item_id = v_si.id;
    if v_qty < 1 or v_already + v_qty > v_si.qty then
      raise exception 'VALIDATION: % was already returned', v_si.item_tag using errcode = '22023';
    end if;
    select * into v_item from public.items where id = v_si.item_id for update;
    v_value := round(v_si.final_price * v_qty / v_si.qty, 0);
    v_credit := round(v_value * (1 - v_ded / 100), 0);
    insert into public.sale_return_items (return_id, sale_item_id, item_id, qty, line_value, credit)
    values (v_id, v_si.id, v_si.item_id, v_qty, v_value, v_credit);
    if v_item.tracking = 'piece' then
      update public.items set status = 'in_stock', qty_on_hand = 1 where id = v_item.id;
    else
      update public.items set qty_on_hand = qty_on_hand + v_qty, archived = false where id = v_item.id;
    end if;
    insert into public.stock_moves (item_id, type, qty, reason, sale_id, created_by)
    values (v_item.id, 'return', v_qty, v_no || ': ' || btrim(p_reason), p_sale_id, v_uid);
    v_total_credit := v_total_credit + v_credit;
  end loop;

  -- Credit first cancels anything still owed on this sale; the rest goes back to the client.
  v_applied := least(greatest(v_due, 0), v_total_credit);
  v_out := v_total_credit - v_applied;

  perform set_config('jewelers.finalize_id', v_id::text, true);
  update public.sale_returns
    set credit = v_total_credit, applied_to_due = v_applied,
        settle = case when v_out = 0 then 'balance' else p_settle end,
        refund_amount = case when p_settle in ('cash', 'bank_transfer') then v_out else 0 end,
        exchange_amount = case when p_settle = 'exchange' then v_out else 0 end
    where id = v_id;
  perform set_config('jewelers.finalize_id', '', true);

  return jsonb_build_object('return_id', v_id, 'return_no', v_no, 'credit', v_total_credit,
                            'applied_to_due', v_applied, 'refund', case when p_settle = 'exchange' then 0 else v_out end,
                            'exchange_credit', case when p_settle = 'exchange' then v_out else 0 end);
end $$;
grant execute on function public.return_sale_items(uuid, jsonb, text, text, numeric) to authenticated;

-- Exchange credit is spent as a payment on a new sale: method 'exchange',
-- reference = the return number. Extend the internal payment recorder.
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
  v_ret public.sale_returns;
begin
  if v_method is null or v_method not in ('cash', 'card', 'bank_transfer', 'old_gold', 'exchange', 'other') then
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

  if v_method = 'exchange' then
    select * into v_ret from public.sale_returns where return_no = upper(btrim(p ->> 'reference')) for update;
    if not found or v_ret.settle <> 'exchange' then
      raise exception 'VALIDATION: no exchange credit with number %', p ->> 'reference' using errcode = '22023';
    end if;
    if v_ret.client_id is not null and v_ret.client_id is distinct from p_client_id then
      raise exception 'VALIDATION: that exchange credit belongs to another client' using errcode = '22023';
    end if;
    if v_amount > v_ret.exchange_amount - v_ret.exchange_used then
      raise exception 'VALIDATION: only % exchange credit left on %', v_ret.exchange_amount - v_ret.exchange_used, v_ret.return_no
        using errcode = '22023';
    end if;
    update public.sale_returns set exchange_used = exchange_used + v_amount where id = v_ret.id;
  end if;

  insert into public.payments (sale_id, client_id, method, amount, reference, received_by)
  values (p_sale_id, p_client_id, v_method, v_amount,
          case when v_method = 'exchange' then upper(btrim(p ->> 'reference')) else nullif(btrim(p ->> 'reference'), '') end, p_uid)
  returning id into v_payment_id;

  if v_method = 'old_gold' then
    insert into public.old_gold_receipts (payment_id, description, gross_weight_g, purity, rate_per_g, deduction_pct, value)
    values (v_payment_id, nullif(btrim(v_og ->> 'description'), ''), v_weight,
            upper(v_og ->> 'purity'), v_rate, v_deduction, v_amount);
  end if;

  return v_amount;
end $$;
revoke all on function public._record_payment(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- A sale that has returns can't also be voided (that would return the stock twice).
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
  if exists (select 1 from public.sale_returns where sale_id = p_sale_id) then
    raise exception 'VALIDATION: this sale has returns; record any further changes as a return' using errcode = '22023';
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

-- Gold the shop now owns for melting/refining: old gold taken in on sales + purchases sent to melt.
create or replace function public.melt_pool_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('purity', purity, 'weight_g', w, 'value', v) order by purity)
    from (
      select purity, sum(w) w, sum(v) v from (
        select og.purity, og.gross_weight_g w, og.value v
        from public.old_gold_receipts og join public.payments p on p.id = og.payment_id
        join public.sales s on s.id = p.sale_id and s.status = 'completed'
        union all
        select coalesce(pi.purity, '—'), (pi.gross_weight_g - pi.stone_weight_g) * pi.qty, pi.value
        from public.purchase_items pi where pi.destination = 'melt'
      ) x group by purity
    ) y
  ), '[]'::jsonb);
end $$;
grant execute on function public.melt_pool_summary() to authenticated;
