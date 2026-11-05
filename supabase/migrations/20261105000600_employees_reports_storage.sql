-- =============================================================================
-- Salary log (admin), dashboard + reports (role-aware), private photo storage.
-- Design: FR-6, FR-7; decisions "Employee data", "Reports", "Item photos".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Salary payments: admin only.
-- -----------------------------------------------------------------------------
create table public.salary_payments (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id),
  paid_on     date not null,
  amount      numeric(12, 2) not null check (amount > 0),
  type        text not null check (type in ('salary', 'advance', 'bonus', 'deduction')),
  note        text,
  created_by  uuid not null references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index salary_payments_profile_idx on public.salary_payments (profile_id, paid_on desc);
create trigger salary_payments_append_only before update or delete on public.salary_payments
  for each row execute function public.prevent_update_delete();
create trigger audit after insert on public.salary_payments
  for each row execute function public.audit_row('id');

alter table public.salary_payments enable row level security;
create policy salary_payments_admin_select on public.salary_payments
  for select to authenticated using (public.is_admin());
create policy salary_payments_admin_insert on public.salary_payments
  for insert to authenticated with check (public.is_admin() and created_by = (select auth.uid()));
grant select on public.salary_payments to authenticated;
grant insert (profile_id, paid_on, amount, type, note) on public.salary_payments to authenticated;

-- -----------------------------------------------------------------------------
-- Dashboard. One round trip; the "admin" key is null for staff.
-- Cost on item_costs is per unit (for bulk items, the cost of one unit).
-- -----------------------------------------------------------------------------
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
        from (select og.purity, sum(og.gross_weight_g) w, sum(og.value) v
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
grant execute on function public.dashboard_summary() to authenticated;

-- Per-employee sales performance for a period (admin).
create or replace function public.employee_performance(p_from date, p_to date)
returns table (profile_id uuid, full_name text, sales_count bigint, sales_total numeric, discount_total numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
begin
  perform public.require_admin();
  select timezone into v_tz from public.shop_settings where id = 1;
  return query
  select p.id, p.full_name, count(s.id), coalesce(sum(s.total), 0), coalesce(sum(s.discount_total), 0)
  from public.profiles p
  left join public.sales s
    on s.sold_by = p.id and s.status = 'completed'
   and (s.created_at at time zone v_tz)::date between p_from and p_to
  group by p.id, p.full_name
  order by 4 desc;
end $$;
grant execute on function public.employee_performance(date, date) to authenticated;

-- Admin: cost + margin for one item (keeps cost out of every staff query path).
create or replace function public.item_margin(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cost numeric;
  v_price numeric;
begin
  perform public.require_admin();
  select ic.cost_amount into v_cost from public.item_costs ic where ic.item_id = p_item_id;
  select public.suggested_price(i) into v_price from public.items i where i.id = p_item_id;
  return jsonb_build_object(
    'cost', v_cost, 'suggested_price', v_price,
    'margin', case when v_cost is not null and v_price is not null then v_price - v_cost end
  );
end $$;
grant execute on function public.item_margin(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: private bucket for item photos (WebP/JPEG, max 1 MB each).
-- Path convention: <item_id>/<uuid>.webp
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Idempotent: a remote `db reset` drops our schema objects but not policies on storage.objects.
drop policy if exists item_photos_read on storage.objects;
drop policy if exists item_photos_upload on storage.objects;
drop policy if exists item_photos_remove on storage.objects;

create policy item_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'item-photos' and public.is_active_user());

create policy item_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and public.is_active_user()
    -- first path segment must be an existing item id
    and exists (select 1 from public.items i where i.id::text = (storage.foldername(name))[1])
  );

create policy item_photos_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'item-photos' and public.is_admin());
