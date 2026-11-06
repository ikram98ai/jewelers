-- =============================================================================
-- Melt pile outflow. The pile only ever added up what came in (old gold taken on
-- sales + purchases marked for melting). A melt batch records metal leaving it:
-- melted in the shop (weight before and after, so the loss is known) or sold to a
-- refiner or dealer. Rows are written once; a mistake is voided with a reason,
-- which puts the weight back on the pile. Admin only: shows what the shop paid.
-- =============================================================================

create table public.melt_batches (
  id               uuid primary key default gen_random_uuid(),
  batch_no         text not null unique,
  metal            text not null check (metal in ('gold', 'silver', 'platinum', 'other')),
  purity           text not null,  -- as grouped on the pile; '—' when a piece has none
  weight_g         numeric(10, 3) not null check (weight_g > 0),
  cost_value       numeric(14, 2) not null check (cost_value >= 0),  -- share of what the shop paid
  outcome          text not null check (outcome in ('melted', 'sold')),
  result_weight_g  numeric(10, 3),
  sold_amount      numeric(14, 2),
  note             text check (note is null or length(note) <= 1000),
  created_by       uuid not null references public.profiles (id),
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references public.profiles (id),
  void_reason      text,
  check ((outcome = 'melted' and result_weight_g > 0 and result_weight_g <= weight_g and sold_amount is null)
      or (outcome = 'sold' and sold_amount > 0 and result_weight_g is null))
);
create index melt_batches_created_idx on public.melt_batches (created_at desc);

create trigger melt_batches_guard before update or delete on public.melt_batches
  for each row execute function public.finalize_guard();
create trigger audit after insert or update on public.melt_batches
  for each row execute function public.audit_row('id');

alter table public.melt_batches enable row level security;
create policy melt_batches_select on public.melt_batches
  for select to authenticated using (public.is_admin());
grant select on public.melt_batches to authenticated;

-- What is on the pile now: everything in, minus batches that have not been voided.
create or replace function public._melt_pool()
returns table (metal text, purity text, weight_g numeric, value numeric)
language sql stable security definer set search_path = '' as $$
  select i.metal, i.purity, i.w - coalesce(o.w, 0), greatest(i.v - coalesce(o.v, 0), 0)
  from (
    select x.metal, x.purity, sum(x.w) w, sum(x.v) v from (
      select 'gold' metal, og.purity, og.gross_weight_g w, og.value v
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
revoke all on function public._melt_pool() from public, anon, authenticated;

create or replace function public.melt_pool_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('metal', m.metal, 'purity', m.purity, 'weight_g', m.weight_g, 'value', m.value)
                     order by m.metal, m.purity)
    from public._melt_pool() m
  ), '[]'::jsonb);
end $$;
grant execute on function public.melt_pool_summary() to authenticated;

create or replace function public.record_melt(
  p_metal text, p_purity text, p_weight_g numeric, p_outcome text,
  p_result_weight_g numeric default null, p_sold_amount numeric default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_no text;
  v_on_pile numeric;
  v_value numeric;
begin
  perform public.require_admin();
  -- One at a time, so two people cannot both take the same metal off the pile.
  perform pg_advisory_xact_lock(hashtext('jewelers.melt_pool'));

  select m.weight_g, m.value into v_on_pile, v_value
  from public._melt_pool() m where m.metal = p_metal and m.purity = p_purity;
  if v_on_pile is null then
    raise exception 'VALIDATION: there is no % % on the melt pile', p_purity, p_metal using errcode = '22023';
  end if;
  if p_weight_g is null or p_weight_g <= 0 then
    raise exception 'VALIDATION: enter the weight taken from the pile' using errcode = '22023';
  end if;
  if p_weight_g > v_on_pile then
    raise exception 'VALIDATION: only % g is on the pile', v_on_pile using errcode = '22023';
  end if;
  if p_outcome = 'melted' and (p_result_weight_g is null or p_result_weight_g <= 0 or p_result_weight_g > p_weight_g) then
    raise exception 'VALIDATION: the weight after melting must be above 0 and no more than the weight melted' using errcode = '22023';
  end if;
  if p_outcome = 'sold' and (p_sold_amount is null or p_sold_amount <= 0) then
    raise exception 'VALIDATION: enter the amount received' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('melted', 'sold') then
    raise exception 'VALIDATION: choose melted or sold' using errcode = '22023';
  end if;

  v_no := public._next_doc_no('melt', 'MLT');
  insert into public.melt_batches (id, batch_no, metal, purity, weight_g, cost_value, outcome,
                                   result_weight_g, sold_amount, note, created_by)
  values (v_id, v_no, p_metal, p_purity, p_weight_g,
          case when p_weight_g = v_on_pile then v_value else round(v_value * p_weight_g / v_on_pile, 2) end,
          p_outcome,
          case when p_outcome = 'melted' then p_result_weight_g end,
          case when p_outcome = 'sold' then p_sold_amount end,
          nullif(btrim(p_note), ''), (select auth.uid()));
  return jsonb_build_object('id', v_id, 'batch_no', v_no);
end $$;
grant execute on function public.record_melt(text, text, numeric, text, numeric, numeric, text) to authenticated;

create or replace function public.void_melt_batch(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_voided timestamptz;
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'VALIDATION: give a reason' using errcode = '22023';
  end if;
  select b.voided_at into v_voided from public.melt_batches b where b.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: melt batch' using errcode = 'P0002';
  end if;
  if v_voided is not null then
    raise exception 'VALIDATION: this record is already void' using errcode = '22023';
  end if;
  perform set_config('jewelers.finalize_id', p_id::text, true);
  update public.melt_batches
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = p_id;
  perform set_config('jewelers.finalize_id', '', true);
end $$;
grant execute on function public.void_melt_batch(uuid, text) to authenticated;
