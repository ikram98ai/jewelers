-- =============================================================================
-- Metal rates (per gram, per metal + purity, per day) and the pricing formula.
-- Design: FR-3, decision "Pricing: daily metal rate x net weight + making + stones".
-- =============================================================================

create table public.metal_rates (
  id            uuid primary key default gen_random_uuid(),
  metal         text not null check (metal in ('gold', 'silver', 'platinum')),
  purity        text not null check (purity ~ '^[0-9]{2,3}K?$'),
  rate_per_g    numeric(12, 2) not null check (rate_per_g > 0),
  effective_on  date not null,
  set_by        uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  unique (metal, purity, effective_on)
);
create index metal_rates_lookup_idx on public.metal_rates (metal, purity, effective_on desc);

alter table public.metal_rates enable row level security;
create policy metal_rates_select on public.metal_rates
  for select to authenticated using (public.is_active_user());
grant select on public.metal_rates to authenticated;
-- Writes only through set_metal_rates().

create trigger audit after insert or update on public.metal_rates
  for each row execute function public.audit_row('id');

-- Latest rate on or before the shop's today.
create or replace function public.current_rate(p_metal text, p_purity text)
returns numeric language sql stable security definer set search_path = '' as $$
  select r.rate_per_g
  from public.metal_rates r
  where r.metal = p_metal and r.purity = p_purity
    and r.effective_on <= public.shop_today()
  order by r.effective_on desc
  limit 1;
$$;
grant execute on function public.current_rate(text, text) to authenticated;

-- Rates as they stand today, one row per metal + purity, with the date they were set.
create or replace function public.rates_today()
returns table (metal text, purity text, rate_per_g numeric, effective_on date, is_today boolean)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.metal, r.purity)
         r.metal, r.purity, r.rate_per_g, r.effective_on,
         r.effective_on = public.shop_today()
  from public.metal_rates r
  where r.effective_on <= public.shop_today()
    and public.is_active_user()
  order by r.metal, r.purity, r.effective_on desc;
$$;
grant execute on function public.rates_today() to authenticated;

-- Admin: upsert a set of rates for a day (defaults to shop today).
-- p_rates: [{ "metal": "gold", "purity": "22K", "rate_per_g": 21500 }, ...]
create or replace function public.set_metal_rates(p_rates jsonb, p_effective_on date default null)
returns setof public.metal_rates
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_effective_on, public.shop_today());
begin
  perform public.require_admin();
  if jsonb_typeof(p_rates) <> 'array' or jsonb_array_length(p_rates) = 0 then
    raise exception 'VALIDATION: rates must be a non-empty array' using errcode = '22023';
  end if;
  if v_day > public.shop_today() then
    raise exception 'VALIDATION: cannot set rates for a future date' using errcode = '22023';
  end if;

  return query
  with upserted as (
    insert into public.metal_rates as m (metal, purity, rate_per_g, effective_on, set_by)
    select lower(r ->> 'metal'), upper(r ->> 'purity'), (r ->> 'rate_per_g')::numeric, v_day, (select auth.uid())
    from jsonb_array_elements(p_rates) r
    on conflict (metal, purity, effective_on)
    do update set rate_per_g = excluded.rate_per_g, set_by = excluded.set_by, created_at = now()
    returning m.*
  )
  select * from upserted;
end $$;
grant execute on function public.set_metal_rates(jsonb, date) to authenticated;

-- The one pricing formula. Every screen and report uses this.
--   rate items:  net_weight * rate + making + stone_charge
--                making = making_charge * net_weight (per_gram) | making_charge (fixed)
--   fixed-price items (bulk, or no rate available): fixed_price
-- Returns NULL when a rate item has no rate yet (UI shows "set today's rate").
create or replace function public.price_for(
  p_metal text, p_purity text, p_net_weight_g numeric,
  p_making_type text, p_making_charge numeric, p_stone_charge numeric,
  p_fixed_price numeric
) returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_rate numeric;
  v_making numeric;
begin
  if p_fixed_price is not null then
    return round(p_fixed_price, 0);
  end if;
  if p_net_weight_g is null or p_purity is null or p_metal not in ('gold', 'silver', 'platinum') then
    return null;
  end if;
  v_rate := public.current_rate(p_metal, p_purity);
  if v_rate is null then
    return null;
  end if;
  v_making := case p_making_type
                when 'fixed' then coalesce(p_making_charge, 0)
                else coalesce(p_making_charge, 0) * p_net_weight_g
              end;
  return round(p_net_weight_g * v_rate + v_making + coalesce(p_stone_charge, 0), 0);
end $$;
grant execute on function public.price_for(text, text, numeric, text, numeric, numeric, numeric) to authenticated;
