-- =============================================================================
-- Stock 0.2.0: CSV import of existing stock (admin, all-or-nothing) and
-- stock checks (anyone scans; admin starts, completes, and writes off).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Import: p_rows is an array of objects shaped like receive_stock's p_item plus
-- "category" (name or tag prefix), "qty", "cost_amount", "supplier".
-- One transaction: any bad row aborts the whole import with its row number.
-- -----------------------------------------------------------------------------
create or replace function public.import_items(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_idx int := 0;
  v_cat uuid;
  v_item jsonb;
  v_res jsonb;
  v_count int := 0;
begin
  perform public.require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'VALIDATION: nothing to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'VALIDATION: import at most 2000 rows at a time' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      select c.id into v_cat from public.categories c
      where lower(c.name) = lower(btrim(v_row ->> 'category')) or c.tag_prefix = upper(btrim(v_row ->> 'category'));
      if v_cat is null then
        raise exception 'unknown category "%"', v_row ->> 'category';
      end if;
      v_item := (v_row - 'category' - 'qty' - 'cost_amount' - 'supplier')
                || jsonb_build_object('category_id', v_cat,
                                      'tracking', coalesce(nullif(v_row ->> 'tracking', ''),
                                        (select default_tracking from public.categories where id = v_cat)));
      v_res := public.receive_stock(
        v_item, null,
        coalesce(nullif(v_row ->> 'qty', '')::int, 1),
        case when nullif(v_row ->> 'cost_amount', '') is not null
             then jsonb_build_object('cost_amount', v_row ->> 'cost_amount', 'supplier', v_row ->> 'supplier') end
      );
      v_count := v_count + 1;
    exception when others then
      raise exception 'VALIDATION: row % — %', v_idx, regexp_replace(sqlerrm, '^[A-Z_]+: ', '') using errcode = '22023';
    end;
  end loop;

  return jsonb_build_object('imported', v_count);
end $$;
grant execute on function public.import_items(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Stock checks
-- -----------------------------------------------------------------------------
create table public.stock_checks (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid references public.categories (id),  -- null = all pieces
  status        text not null default 'open' check (status in ('open', 'completed')),
  started_by    uuid not null references public.profiles (id),
  started_at    timestamptz not null default now(),
  completed_by  uuid references public.profiles (id),
  completed_at  timestamptz,
  expected      int,   -- snapshot at completion
  found         int
);
-- Only one open check at a time keeps scanning simple at the counter.
create unique index stock_checks_one_open on public.stock_checks ((true)) where status = 'open';

create table public.stock_check_items (
  check_id  uuid not null references public.stock_checks (id),
  item_id   uuid not null references public.items (id),
  seen_by   uuid not null references public.profiles (id),
  seen_at   timestamptz not null default now(),
  primary key (check_id, item_id)
);

alter table public.stock_checks enable row level security;
alter table public.stock_check_items enable row level security;
create policy stock_checks_select on public.stock_checks for select to authenticated using (public.is_active_user());
create policy stock_check_items_select on public.stock_check_items for select to authenticated using (public.is_active_user());
grant select on public.stock_checks, public.stock_check_items to authenticated;

create trigger audit after insert or update on public.stock_checks
  for each row execute function public.audit_row('id');

create or replace function public.start_stock_check(p_category_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.require_admin();
  insert into public.stock_checks (category_id, started_by) values (p_category_id, (select auth.uid()))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'VALIDATION: a stock check is already open — finish it first' using errcode = '22023';
end $$;
grant execute on function public.start_stock_check(uuid) to authenticated;

-- Anyone signed in can scan pieces into the open check.
create or replace function public.stock_check_scan(p_check_id uuid, p_tag text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check public.stock_checks;
  v_item public.items;
  v_inserted int;
begin
  perform public.require_active_user();
  select * into v_check from public.stock_checks where id = p_check_id;
  if not found or v_check.status <> 'open' then
    raise exception 'VALIDATION: this stock check is closed' using errcode = '22023';
  end if;
  select * into v_item from public.items
  where tag = upper(btrim(p_tag)) or legacy_tag = btrim(p_tag)
  order by (tag = upper(btrim(p_tag))) desc limit 1;
  if not found then
    raise exception 'NOT_FOUND: no item with tag %', p_tag using errcode = 'P0002';
  end if;

  insert into public.stock_check_items (check_id, item_id, seen_by)
  values (p_check_id, v_item.id, (select auth.uid()))
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'item_id', v_item.id, 'tag', v_item.tag, 'name', v_item.name, 'status', v_item.status,
    'already_seen', v_inserted = 0,
    -- warn if a sold / written-off piece turns up, or it's outside this check's category
    'unexpected', v_item.status <> 'in_stock' or (v_check.category_id is not null and v_item.category_id <> v_check.category_id)
  );
end $$;
grant execute on function public.stock_check_scan(uuid, text) to authenticated;

-- In-stock pieces in scope that nobody has scanned yet.
create or replace function public.stock_check_missing(p_check_id uuid)
returns table (item_id uuid, tag text, name text, net_weight_g numeric, category text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.tag, i.name, i.net_weight_g, c.name
  from public.stock_checks sc
  join public.items i on i.tracking = 'piece' and i.status = 'in_stock' and not i.archived
                     and (sc.category_id is null or i.category_id = sc.category_id)
  join public.categories c on c.id = i.category_id
  where sc.id = p_check_id and public.is_active_user()
    and not exists (select 1 from public.stock_check_items x where x.check_id = sc.id and x.item_id = i.id)
  order by i.tag;
$$;
grant execute on function public.stock_check_missing(uuid) to authenticated;

create or replace function public.complete_stock_check(p_check_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_expected int;
  v_found int;
begin
  perform public.require_admin();
  select count(*) into v_found from public.stock_check_items where check_id = p_check_id;
  select v_found + count(*) into v_expected from public.stock_check_missing(p_check_id);
  update public.stock_checks
    set status = 'completed', completed_by = (select auth.uid()), completed_at = now(),
        expected = v_expected, found = v_found
    where id = p_check_id and status = 'open';
  if not found then
    raise exception 'VALIDATION: check is not open' using errcode = '22023';
  end if;
  return jsonb_build_object('expected', v_expected, 'found', v_found, 'missing', v_expected - v_found);
end $$;
grant execute on function public.complete_stock_check(uuid) to authenticated;
