-- Old gold taken as payment: value and melt pile weight now use net weight
-- (gross - stones), like a purchase. Only those lines change in these functions.
alter table public.old_gold_receipts
  add column stone_weight_g numeric(10, 3) not null default 0 check (stone_weight_g >= 0);

create or replace function public._record_payment(p_sale_id uuid, p_client_id uuid, p jsonb, p_uid uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_method text := p ->> 'method';
  v_amount numeric;
  v_payment_id uuid;
  v_og jsonb := p -> 'old_gold';
  v_weight numeric;
  v_stone numeric;
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
    v_stone := coalesce((v_og ->> 'stone_weight_g')::numeric, 0);
    v_rate := (v_og ->> 'rate_per_g')::numeric;
    v_deduction := coalesce((v_og ->> 'deduction_pct')::numeric,
                            (select old_gold_deduction_pct from public.shop_settings where id = 1));
    if v_weight is null or v_weight <= 0 or v_rate is null or v_rate <= 0 or v_deduction < 0 or v_deduction > 50 then
      raise exception 'VALIDATION: invalid old gold weight, rate or deduction' using errcode = '22023';
    end if;
    if v_stone < 0 or v_stone >= v_weight then
      raise exception 'VALIDATION: stone weight must be less than the total weight' using errcode = '22023';
    end if;
    v_amount := round((v_weight - v_stone) * v_rate * (1 - v_deduction / 100), 0);
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
    insert into public.old_gold_receipts (payment_id, description, gross_weight_g, stone_weight_g, purity, rate_per_g, deduction_pct, value)
    values (v_payment_id, nullif(btrim(v_og ->> 'description'), ''), v_weight, v_stone,
            upper(v_og ->> 'purity'), v_rate, v_deduction, v_amount);
  end if;

  return v_amount;
end $$;

create or replace function public._melt_pool()
returns table (metal text, purity text, weight_g numeric, value numeric)
language sql stable security definer set search_path = '' as $$
  select i.metal, i.purity, i.w - coalesce(o.w, 0), greatest(i.v - coalesce(o.v, 0), 0)
  from (
    select x.metal, x.purity, sum(x.w) w, sum(x.v) v from (
      select 'gold' metal, og.purity, og.gross_weight_g - og.stone_weight_g w, og.value v
      from public.old_gold_receipts og
      join public.payments p on p.id = og.payment_id
      join public.sales s on s.id = p.sale_id and s.status = 'completed'
      union all
      select pi.metal, coalesce(pi.purity, '—'), (pi.gross_weight_g - pi.stone_weight_g) * pi.qty, pi.value
      from public.purchase_items pi where pi.destination = 'melt'
    ) x group by x.metal, x.purity
  ) i
  left join (
    select b.metal, b.purity, sum(b.weight_g) w, sum(b.cost_value) v
    from public.melt_batches b where b.voided_at is null group by b.metal, b.purity
  ) o on o.metal = i.metal and o.purity = i.purity
  where i.w - coalesce(o.w, 0) > 0;
$$;

create or replace function public.dashboard_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_tz text;
  v_month_start date;
  v_result jsonb;
  v_admin jsonb := null;
begin
  perform public.require_active_user();
  select timezone into v_tz from public.shop_settings where id = 1;
  v_today := public.shop_today();
  v_month_start := date_trunc('month', v_today)::date;

  select jsonb_build_object(
    'today', v_today,
    'rates', coalesce((select jsonb_agg(to_jsonb(r)) from public.rates_today() r), '[]'::jsonb),
    'rates_set_today', exists (select 1 from public.metal_rates where effective_on = v_today),
    'sales_today', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0))
      from public.sales
      where status = 'completed' and (created_at at time zone v_tz)::date = v_today
    ),
    'payments_today', (
      select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb)
      from (select p.method, sum(p.amount) amt
            from public.payments p join public.sales s on s.id = p.sale_id
            where s.status = 'completed' and (p.created_at at time zone v_tz)::date = v_today
            group by p.method) x
    ),
    'pieces_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', c.name, 'pieces', x.pieces, 'net_weight_g', x.w) order by c.name)
      from (select category_id, sum(qty_on_hand) pieces, sum(net_weight_g * qty_on_hand) w
            from public.items where status = 'in_stock' and not archived and qty_on_hand > 0
            group by category_id) x
      join public.categories c on c.id = x.category_id
    ), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'tag', tag, 'name', name, 'qty_on_hand', qty_on_hand, 'low_stock_at', low_stock_at))
      from public.items
      where tracking = 'bulk' and not archived and low_stock_at is not null and qty_on_hand <= low_stock_at
    ), '[]'::jsonb),
    'balances_due', coalesce((
      select jsonb_agg(x)
      from (select c.id, c.full_name, c.phone, b.balance
            from public.client_balances b join public.clients c on c.id = b.client_id
            where b.balance > 0 order by b.balance desc limit 10) x
    ), '[]'::jsonb),
    'upcoming_dates', coalesce((
      select jsonb_agg(x)
      from (
        select c.id, c.full_name, c.phone, 'birthday' as kind, c.birthday as date
        from public.clients c
        where not c.archived and c.birthday is not null
          and to_char(c.birthday, 'MM-DD') in (select to_char(v_today + g, 'MM-DD') from generate_series(0, 6) g)
        union all
        select c.id, c.full_name, c.phone, 'anniversary', c.anniversary
        from public.clients c
        where not c.archived and c.anniversary is not null
          and to_char(c.anniversary, 'MM-DD') in (select to_char(v_today + g, 'MM-DD') from generate_series(0, 6) g)
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  if public.is_admin() then
    select jsonb_build_object(
      'stock_value_cost', (
        select coalesce(sum(ic.cost_amount * i.qty_on_hand), 0)
        from public.items i join public.item_costs ic on ic.item_id = i.id
        where i.status = 'in_stock' and i.qty_on_hand > 0
      ),
      'stock_value_today', (
        select coalesce(sum(public.suggested_price(i) * i.qty_on_hand), 0)
        from public.items i where i.status = 'in_stock' and i.qty_on_hand > 0
      ),
      'gross_profit_today', (
        select coalesce(sum(si.final_price - ic.cost_amount * si.qty), 0)
        from public.sale_items si
        join public.sales s on s.id = si.sale_id and s.status = 'completed'
        join public.item_costs ic on ic.item_id = si.item_id
        where (s.created_at at time zone v_tz)::date = v_today
      ),
      'gross_profit_month', (
        select coalesce(sum(si.final_price - ic.cost_amount * si.qty), 0)
        from public.sale_items si
        join public.sales s on s.id = si.sale_id and s.status = 'completed'
        join public.item_costs ic on ic.item_id = si.item_id
        where (s.created_at at time zone v_tz)::date >= v_month_start
      ),
      'sales_month', (
        select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0))
        from public.sales where status = 'completed' and (created_at at time zone v_tz)::date >= v_month_start
      ),
      'discounts_by_staff', coalesce((
        select jsonb_agg(x order by x.discount desc)
        from (select p.full_name, count(*) sales, sum(s.discount_total) discount
              from public.sales s join public.profiles p on p.id = s.sold_by
              where s.status = 'completed' and (s.created_at at time zone v_tz)::date >= v_month_start
              group by p.full_name) x
      ), '[]'::jsonb),
      'missing_cost_count', (
        select count(*) from public.items i
        where i.status = 'in_stock' and not i.archived
          and not exists (select 1 from public.item_costs ic where ic.item_id = i.id)
      ),
      'old_gold_month', coalesce((
        select jsonb_agg(jsonb_build_object('purity', purity, 'weight_g', w, 'value', v))
        from (select og.purity, sum(og.gross_weight_g - og.stone_weight_g) w, sum(og.value) v
              from public.old_gold_receipts og
              join public.payments p on p.id = og.payment_id
              join public.sales s on s.id = p.sale_id and s.status = 'completed'
              where (p.created_at at time zone v_tz)::date >= v_month_start
              group by og.purity) x
      ), '[]'::jsonb)
    ) into v_admin;
  end if;

  return v_result || jsonb_build_object('admin', v_admin);
end $$;
