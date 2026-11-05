-- =============================================================================
-- Demo data: a jewellery shop in Liaquat Bazaar, Quetta.
--   2 owners (admins), 3 staff, 10 clients, 100 items in stock, 50 sales over the
--   last 60 days (54 pieces sold, some on part-payment), bridal sets with their
--   listed parts, safekeeping (amanat) receipts, daily metal rates, salaries.
--
-- Contains NO logins or passwords. The five logins must already exist in Auth
-- (created through the admin API by `pnpm db:remote:reseed`):
--   ismail, ibrahim (admins) · naseeb, wahid, zahid (staff)   @ shop.local
-- Run only through:  pnpm db:remote:reseed  (reset → logins → supabase db query --linked -f supabase/seeds/demo.sql)
-- Metal rates are realistic placeholders: set real ones on the Rates page.
-- =============================================================================

select setseed(0.20261105);

-- ---------------------------------------------------------------------------
-- Helpers (session-only)
-- ---------------------------------------------------------------------------
create function pg_temp.uid(p_username text) returns uuid language sql stable as $$
  select id from auth.users where lower(email) = lower(p_username || '@shop.local') limit 1
$$;

create function pg_temp.rate_on(p_metal text, p_purity text, p_day date) returns numeric language sql stable as $$
  select rate_per_g from public.metal_rates
  where metal = p_metal and purity = p_purity and effective_on <= p_day
  order by effective_on desc limit 1
$$;

create function pg_temp.price_on(i public.items, p_day date) returns numeric language sql stable as $$
  select case when i.fixed_price is not null then round(i.fixed_price)
         else round(i.net_weight_g * pg_temp.rate_on(i.metal, i.purity, p_day)
                    + case i.making_type when 'fixed' then i.making_charge else i.making_charge * i.net_weight_g end
                    + i.stone_charge) end
$$;

create function pg_temp.rnd(lo numeric, hi numeric, digits int default 0) returns numeric language sql volatile as $$
  select round((lo + random() * (hi - lo))::numeric, digits)
$$;

create function pg_temp.add_item(
  p_tracking text, p_prefix text, p_name text, p_metal text, p_purity text,
  p_gross numeric, p_stone numeric, p_mtype text, p_making numeric, p_stone_charge numeric,
  p_fixed numeric, p_qty int, p_low int, p_received timestamptz, p_by uuid, p_supplier text
) returns uuid language plpgsql as $$
declare
  v public.items;
  v_cost numeric;
begin
  insert into public.items (tracking, category_id, name, metal, purity, gross_weight_g, stone_weight_g,
                            making_type, making_charge, stone_charge, fixed_price, qty_on_hand, low_stock_at,
                            status, created_by, created_at, updated_at)
  values (p_tracking, (select id from public.categories where tag_prefix = p_prefix), p_name, p_metal, p_purity,
          p_gross, coalesce(p_stone, 0), coalesce(p_mtype, 'per_gram'), coalesce(p_making, 0), coalesce(p_stone_charge, 0),
          p_fixed, p_qty, p_low, 'in_stock', p_by, p_received, p_received)
  returning * into v;

  insert into public.stock_moves (item_id, type, qty, created_by, created_at)
  values (v.id, 'receive', p_qty, p_by, p_received);

  -- Purchase cost: metal at that day's rate (slightly under) + ~45% of making/stone charges.
  if v.fixed_price is not null then
    v_cost := round(v.fixed_price * (0.60 + random() * 0.12));
  else
    v_cost := round(v.net_weight_g * pg_temp.rate_on(v.metal, v.purity, p_received::date) * 0.985
                    + (case v.making_type when 'fixed' then v.making_charge else v.making_charge * v.net_weight_g end
                       + v.stone_charge) * 0.45);
  end if;
  insert into public.item_costs (item_id, cost_amount, supplier, purchase_date)
  values (v.id, v_cost, p_supplier, p_received::date);
  return v.id;
end $$;

-- One complete sale, written exactly the way create_sale() would (snapshots,
-- stock moves, gap-free invoice number), but with a historical timestamp.
create function pg_temp.sell(
  p_when timestamptz, p_by uuid, p_client uuid, p_items uuid[], p_qtys int[],
  p_discount_pct numeric, p_plan text
) returns uuid language plpgsql as $$
declare
  v_sale uuid := gen_random_uuid();
  v_day date := (p_when at time zone 'Asia/Karachi')::date;
  v_year int := extract(year from v_day)::int;
  v_no int;
  v_item public.items;
  v_sugg numeric; v_final numeric; v_rate numeric; v_making numeric;
  v_sub numeric := 0; v_total numeric := 0;
  v_sugg_arr numeric[] := '{}'; v_final_arr numeric[] := '{}';
  v_cash numeric; v_og_rate numeric; v_og_ded numeric; v_og_w numeric; v_og_val numeric; v_pid uuid;
begin
  for i in 1 .. array_length(p_items, 1) loop
    select * into v_item from public.items where id = p_items[i];
    v_sugg := pg_temp.price_on(v_item, v_day) * p_qtys[i];
    v_final := greatest(floor(v_sugg * (1 - p_discount_pct / 100) / 100) * 100, 100);
    v_sugg_arr := v_sugg_arr || v_sugg; v_final_arr := v_final_arr || v_final;
    v_sub := v_sub + v_sugg; v_total := v_total + v_final;
  end loop;

  insert into public.invoice_counters as ic (year, last_no) values (v_year, 1)
  on conflict (year) do update set last_no = ic.last_no + 1 returning last_no into v_no;

  insert into public.sales (id, invoice_no, client_id, sold_by, subtotal, discount_total, total, created_at)
  values (v_sale, 'INV-' || v_year || '-' || lpad(v_no::text, 5, '0'), p_client, p_by, v_sub, v_sub - v_total, v_total, p_when);

  for i in 1 .. array_length(p_items, 1) loop
    select * into v_item from public.items where id = p_items[i];
    if v_item.fixed_price is null then
      v_rate := pg_temp.rate_on(v_item.metal, v_item.purity, v_day);
      v_making := case v_item.making_type when 'fixed' then v_item.making_charge
                  else round(v_item.making_charge * v_item.net_weight_g, 2) end;
    else
      v_rate := null; v_making := 0;
    end if;
    insert into public.sale_items (sale_id, item_id, qty, item_tag, item_name, metal, purity, net_weight_g, rate_per_g,
                                   making_amount, stone_amount, suggested_price, final_price, created_at)
    values (v_sale, v_item.id, p_qtys[i], v_item.tag, v_item.name, v_item.metal, v_item.purity, v_item.net_weight_g, v_rate,
            v_making, case when v_item.fixed_price is null then v_item.stone_charge else 0 end,
            v_sugg_arr[i], v_final_arr[i], p_when);
    if v_item.tracking = 'piece' then
      update public.items set status = 'sold', qty_on_hand = 0 where id = v_item.id;
    else
      update public.items set qty_on_hand = qty_on_hand - p_qtys[i] where id = v_item.id;
    end if;
    insert into public.stock_moves (item_id, type, qty, sale_id, created_by, created_at)
    values (v_item.id, 'sale', -p_qtys[i], v_sale, p_by, p_when);
  end loop;

  -- Payments
  if p_plan = 'old_gold' then
    v_og_rate := floor(pg_temp.rate_on('gold', '22K', v_day) * 0.98 / 10) * 10;
    v_og_ded := pg_temp.rnd(2, 4, 1);
    v_og_w := round((v_total * pg_temp.rnd(0.3, 0.6, 2)) / (v_og_rate * (1 - v_og_ded / 100)), 3);
    v_og_val := round(v_og_w * v_og_rate * (1 - v_og_ded / 100));
    insert into public.payments (sale_id, client_id, method, amount, received_by, created_at)
    values (v_sale, p_client, 'old_gold', v_og_val, p_by, p_when) returning id into v_pid;
    insert into public.old_gold_receipts (payment_id, description, gross_weight_g, purity, rate_per_g, deduction_pct, value)
    values (v_pid, (array['Old ring', 'Old earrings', 'Broken chain', 'Old bangle', 'Old pendant'])[1 + floor(random() * 5)::int],
            v_og_w, '22K', v_og_rate, v_og_ded, v_og_val);
    insert into public.payments (sale_id, client_id, method, amount, received_by, created_at)
    values (v_sale, p_client, 'cash', v_total - v_og_val, p_by, p_when);
  elsif p_plan = 'split' then
    v_cash := round(v_total * pg_temp.rnd(0.3, 0.6, 2) / 1000) * 1000;
    insert into public.payments (sale_id, client_id, method, amount, received_by, created_at) values
      (v_sale, p_client, 'cash', v_cash, p_by, p_when);
    insert into public.payments (sale_id, client_id, method, amount, reference, received_by, created_at) values
      (v_sale, p_client, 'card', v_total - v_cash, 'POS-' || lpad(floor(random() * 1e6)::text, 6, '0'), p_by, p_when);
  elsif p_plan = 'credit' then
    v_cash := round(v_total * pg_temp.rnd(0.4, 0.7, 2) / 1000) * 1000;
    insert into public.payments (sale_id, client_id, method, amount, received_by, created_at)
    values (v_sale, p_client, 'cash', v_cash, p_by, p_when);
  elsif p_plan = 'card' then
    insert into public.payments (sale_id, client_id, method, amount, reference, received_by, created_at)
    values (v_sale, p_client, 'card', v_total, 'POS-' || lpad(floor(random() * 1e6)::text, 6, '0'), p_by, p_when);
  elsif p_plan = 'bank' then
    insert into public.payments (sale_id, client_id, method, amount, reference, received_by, created_at)
    values (v_sale, p_client, 'bank_transfer', v_total,
            (array['HBL', 'Meezan', 'MCB', 'UBL', 'JazzCash'])[1 + floor(random() * 5)::int] || ' ' || lpad(floor(random() * 1e8)::text, 8, '0'),
            p_by, p_when);
  else
    insert into public.payments (sale_id, client_id, method, amount, received_by, created_at)
    values (v_sale, p_client, 'cash', v_total, p_by, p_when);
  end if;
  return v_sale;
end $$;

-- A set's parts, as fractions of the set's gross weight. Variants differ in what they include.
create function pg_temp.add_set_parts(p_item uuid, p_variant int) returns void language plpgsql as $$
declare
  g numeric := (select gross_weight_g from public.items where id = p_item);
  by_user uuid := (select created_by from public.items where id = p_item);
begin
  insert into public.item_components (item_id, kind, description, qty, gross_weight_g, stone_weight_g, sort_order, created_by)
  select p_item, x.kind, x.descr, x.qty, round(g * x.share, 3), round(g * x.share * x.stone, 3), x.ord, by_user
  from (values
    (1, 'necklace', 'Kundan necklace',          1, 0.46, 0.06, 1),
    (1, 'earrings', 'Matching jhumka pair',     1, 0.16, 0.04, 2),
    (1, 'tikka',    'Maang tikka',              1, 0.08, 0.05, 3),
    (1, 'bangle',   'Bangles',                  2, 0.15, 0.00, 4),
    (1, 'ring',     'Ring',                     1, 0.05, 0.03, 5),
    (2, 'necklace', 'Rani haar (long necklace)', 1, 0.55, 0.04, 1),
    (2, 'earrings', 'Earrings pair',            1, 0.18, 0.03, 2),
    (2, 'jhoomar',  'Jhoomar (side ornament)',  1, 0.12, 0.05, 3),
    (2, 'ring',     'Ring',                     1, 0.05, 0.02, 4),
    (3, 'necklace', 'Choker',                   1, 0.40, 0.05, 1),
    (3, 'earrings', 'Earrings pair',            1, 0.15, 0.04, 2),
    (3, 'bangle',   'Karas',                    4, 0.10, 0.00, 3),
    (3, 'tikka',    'Tikka',                    1, 0.05, 0.04, 4)
  ) as x(variant, kind, descr, qty, share, stone, ord)
  where x.variant = 1 + (p_variant - 1) % 3;
end $$;

-- ---------------------------------------------------------------------------
-- The data
-- ---------------------------------------------------------------------------
do $seed$
declare
  u_ismail uuid := pg_temp.uid('ismail');
  u_ibrahim uuid := pg_temp.uid('ibrahim');
  u_naseeb uuid := pg_temp.uid('naseeb');
  u_wahid uuid := pg_temp.uid('wahid');
  u_zahid uuid := pg_temp.uid('zahid');
  staff uuid[];
  sellers uuid[];
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  f numeric; g numeric; r24 numeric; s999 numeric;
  t record;
  pool uuid[];
  bulk uuid[];
  clients uuid[];
  v_id uuid;
  v_when timestamptz;
  v_day int;
  v_client uuid;
  v_items uuid[];
  v_qtys int[];
  v_plan text;
  v_sale uuid;
  v_bal numeric;
  p int := 1;
  v_cno int;
  credit_sales uuid[] := '{}';
  v_by uuid;
begin
  -- Safe to re-run (the Management API may retry a long request): stop if already loaded.
  if exists (select 1 from public.profiles) then
    raise notice 'Demo data is already loaded; nothing to do.';
    return;
  end if;
  if u_ismail is null or u_ibrahim is null or u_naseeb is null or u_wahid is null or u_zahid is null then
    raise exception 'Create the 5 logins (ismail, ibrahim, naseeb, wahid, zahid @shop.local) before seeding';
  end if;
  staff := array[u_naseeb, u_wahid, u_zahid];
  sellers := array[u_naseeb, u_wahid, u_zahid, u_naseeb, u_wahid, u_zahid, u_ibrahim, u_ismail];

  -- People ------------------------------------------------------------------
  insert into public.profiles (id, username, full_name, role, phone, created_at) values
    (u_ismail,  'ismail',  'Ismail Shah',          'admin', '03000000001', now() - interval '200 days'),
    (u_ibrahim, 'ibrahim', 'Haji Ibrahim',         'admin', '03000000002', now() - interval '200 days'),
    (u_naseeb,  'naseeb',  'Naseebullah',    'staff', '03000000003', now() - interval '200 days'),
    (u_wahid,   'wahid',   'Abdul Wahid', 'staff', '03000000004', now() - interval '200 days'),
    (u_zahid,   'zahid',   'Zahid Khan',    'staff', '03000000005', now() - interval '200 days');

  insert into public.employee_hr (profile_id, joined_on, monthly_salary, address, emergency_contact, notes) values
    (u_ismail,  '1998-03-01', null,  'Jinnah Town, Quetta',      null, 'Owner'),
    (u_ibrahim, '1998-03-01', null,  'Satellite Town, Quetta',   null, 'Owner'),
    (u_naseeb,  '2017-06-15', 55000, 'Pashtunabad, Quetta',      'Brother: 03000000013', 'Senior salesman; handles bridal orders'),
    (u_wahid,   '2020-09-01', 45000, 'Sariab Road, Quetta',      'Father: 03000000014', 'Salesman'),
    (u_zahid,   '2023-02-10', 38000, 'Brewery Road, Quetta',     'Uncle: 03000000015', 'Salesman; also does the stock checks');

  for m in 0 .. 1 loop
    insert into public.salary_payments (profile_id, paid_on, amount, type, note, created_by)
    select s.id, (date_trunc('month', v_today) - (m || ' month')::interval)::date, s.sal, 'salary',
           to_char(date_trunc('month', v_today) - ((m + 1) || ' month')::interval, 'FMMonth') || ' salary', u_ismail
    from (values (u_naseeb, 55000), (u_wahid, 45000), (u_zahid, 38000)) s(id, sal);
  end loop;
  insert into public.salary_payments (profile_id, paid_on, amount, type, note, created_by) values
    (u_wahid, v_today - 12, 10000, 'advance', 'Advance for family wedding', u_ibrahim),
    (u_naseeb, v_today - 30, 5000, 'bonus', 'Bridal set sale', u_ismail);

  -- Shop ----------------------------------------------------------------------
  update public.shop_settings set
    shop_name = 'Shah & Ibrahim Jewellers', address = 'Liaquat Bazaar, Quetta', phone = '081-0000000',
    currency_code = 'PKR', currency_symbol = 'Rs', timezone = 'Asia/Karachi', phone_country_code = '92',
    old_gold_deduction_pct = 3, weight_unit = 'tola';

  insert into public.categories (name, tag_prefix, default_tracking) values
    ('Gold bar & coin', 'GLD', 'piece'), ('Silver', 'SLV', 'piece'), ('Gemstone', 'GEM', 'piece');

  -- Daily rates for the last 130 days (gentle upward trend) ---------------------
  for k in 0 .. 130 loop
    f := 1 - 0.00045 * k + 0.007 * sin(k / 6.0);
    g := 1 - 0.0004 * k + 0.012 * sin(k / 9.0);
    r24 := round(38600 * f / 5) * 5;
    s999 := round(455 * g);
    insert into public.metal_rates (metal, purity, rate_per_g, effective_on, set_by, created_at) values
      ('gold', '24K', r24,                   v_today - k, u_ismail, (v_today - k) + time '10:05'),
      ('gold', '22K', round(r24 * 22 / 24),  v_today - k, u_ismail, (v_today - k) + time '10:05'),
      ('gold', '21K', round(r24 * 21 / 24),  v_today - k, u_ismail, (v_today - k) + time '10:05'),
      ('gold', '18K', round(r24 * 18 / 24),  v_today - k, u_ismail, (v_today - k) + time '10:05'),
      ('silver', '999', s999,                v_today - k, u_ismail, (v_today - k) + time '10:05'),
      ('silver', '925', round(s999 * 0.925), v_today - k, u_ismail, (v_today - k) + time '10:05');
  end loop;

  -- Stock: (prefix, name, purity, gross min/max, stone min/max, making min/max, making type,
  --         stone charge min/max, how many in stock now, how many already sold) --------
  pool := '{}';
  for t in
    select * from (values
      ('RNG', 'Ladies ring, floral',             '22K',  3.0,   5.5, 0.0, 0.0, 1500, 2200, 'per_gram',     0,      0, 4, 5),
      ('RNG', 'Gents ring, plain band',          '21K',  5.0,   9.0, 0.0, 0.0, 1200, 1600, 'per_gram',     0,      0, 3, 3),
      ('RNG', 'Ladies ring with ruby (yaqoot)',  '22K',  3.5,   6.0, 0.3, 0.6, 1800, 2500, 'per_gram',  8000,  25000, 3, 2),
      ('RNG', 'Gents ring with feroza',          '21K',  6.0,  10.0, 0.8, 1.5, 1400, 1800, 'per_gram',  6000,  15000, 3, 2),
      ('RNG', 'Engagement ring, zircon',         '18K',  2.5,   4.0, 0.2, 0.4, 2000, 2800, 'per_gram',  3000,   6000, 4, 3),
      ('EAR', 'Jhumka earrings',                 '22K',  8.0,  14.0, 0.3, 0.8, 10000, 16000, 'fixed',   2000,   5000, 4, 3),
      ('EAR', 'Tops (studs)',                    '22K',  2.0,   4.0, 0.0, 0.0, 1500, 2000, 'per_gram',     0,      0, 4, 4),
      ('EAR', 'Bali hoops',                      '21K',  4.0,   7.0, 0.0, 0.0, 1300, 1700, 'per_gram',     0,      0, 4, 3),
      ('BNG', 'Plain bangle (churi)',            '21K', 10.0,  14.0, 0.0, 0.0, 1000, 1400, 'per_gram',     0,      0, 6, 3),
      ('BNG', 'Kara, carved',                    '22K', 20.0,  35.0, 0.0, 0.0, 1200, 1600, 'per_gram',     0,      0, 4, 2),
      ('NCK', 'Necklace, kundan',                '22K', 25.0,  45.0, 2.0, 5.0, 2200, 3000, 'per_gram', 30000,  70000, 4, 2),
      ('NCK', 'Necklace, Balochi design',        '22K', 30.0,  55.0, 0.0, 0.0, 2000, 2600, 'per_gram',     0,      0, 4, 2),
      ('NCK', 'Choker with ruby',                '22K', 20.0,  35.0, 1.5, 3.0, 2400, 3000, 'per_gram', 40000,  90000, 3, 1),
      ('BRC', 'Ladies bracelet',                 '21K',  8.0,  15.0, 0.0, 0.0, 1300, 1800, 'per_gram',     0,      0, 6, 2),
      ('CHN', 'Rope chain 20 inch',              '21K',  6.0,  12.0, 0.0, 0.0,  900, 1200, 'per_gram',     0,      0, 4, 3),
      ('CHN', 'Box chain 18 inch',               '18K',  4.0,   8.0, 0.0, 0.0,  900, 1200, 'per_gram',     0,      0, 3, 2),
      ('PND', 'Ayat-ul-Kursi pendant',           '21K',  3.0,   6.0, 0.0, 0.0, 1500, 2000, 'per_gram',     0,      0, 4, 3),
      ('PND', 'Locket with emerald',             '22K',  3.0,   5.0, 0.3, 0.6, 1800, 2400, 'per_gram', 10000,  25000, 3, 1),
      ('SET', 'Bridal set (necklace, earrings, tikka)', '22K', 70.0, 110.0, 4.0, 8.0, 2500, 3200, 'per_gram', 60000, 150000, 2, 1),
      ('GLD', 'Gold biscuit 1 tola',             '24K', 11.664, 11.664, 0.0, 0.0, 1500, 1500, 'fixed',     0,      0, 3, 2),
      ('GLD', 'Gold biscuit 5 tola',             '24K', 58.320, 58.320, 0.0, 0.0, 4000, 4000, 'fixed',     0,      0, 1, 0),
      ('GLD', 'Gold biscuit 10 tola',            '24K', 116.64, 116.64, 0.0, 0.0, 6000, 6000, 'fixed',     0,      0, 1, 0),
      ('GLD', 'Gold coin 10 g',                  '24K', 10.0,  10.0, 0.0, 0.0, 1200, 1200, 'fixed',        0,      0, 2, 1),
      ('GLD', 'Gold bar 20 g',                   '24K', 20.0,  20.0, 0.0, 0.0, 1800, 1800, 'fixed',        0,      0, 1, 0),
      ('SLV', 'Silver bar 100 g',                '999', 100.0, 100.0, 0.0, 0.0,  800,  800, 'fixed',       0,      0, 2, 1),
      ('SLV', 'Silver bar 500 g',                '999', 500.0, 500.0, 0.0, 0.0, 2500, 2500, 'fixed',       0,      0, 1, 0),
      ('SLV', 'Silver glass pair (gilas)',       '925', 180.0, 240.0, 0.0, 0.0,   40,   60, 'per_gram',    0,      0, 1, 0),
      ('SLV', 'Silver bracelet, oxidised',       '925', 25.0,  40.0, 0.0, 0.0,   60,   90, 'per_gram',     0,      0, 1, 1)
    ) as x(prefix, name, purity, gmin, gmax, smin, smax, mmin, mmax, mtype, scmin, scmax, n_stock, n_sold)
  loop
    for n in 1 .. (t.n_stock + t.n_sold) loop
      v_id := pg_temp.add_item(
        'piece', t.prefix, t.name, case when t.purity in ('999', '925') then 'silver' else 'gold' end, t.purity,
        pg_temp.rnd(t.gmin, t.gmax, 3), pg_temp.rnd(t.smin, t.smax, 3), t.mtype,
        round(pg_temp.rnd(t.mmin, t.mmax) / 50) * 50, round(pg_temp.rnd(t.scmin, t.scmax) / 500) * 500, null,
        1, null, (v_today - pg_temp.rnd(62, 128)::int) + time '12:00' + pg_temp.rnd(0, 360)::int * interval '1 minute',
        staff[1 + floor(random() * 3)::int],
        (array['Karigar Bashir', 'Karigar Naeem (Karachi)', 'Al-Madina Gold, Quetta', 'Kandahari Workshop'])[1 + floor(random() * 4)::int]);
      if t.prefix = 'SET' then perform pg_temp.add_set_parts(v_id, n); end if;
      if n > t.n_stock then pool := pool || v_id; end if;   -- these pieces will be sold below
    end loop;
  end loop;

  -- Gemstones (loose, fixed price): 8 in stock + 2 to sell
  for t in
    select * from (values
      ('Ruby (yaqoot), Mozambique 2.1 ct', 185000, false), ('Ruby, Burmese 1.05 ct', 240000, false),
      ('Emerald (zamurd), Swat 1.8 ct', 160000, false),    ('Blue sapphire (neelam) 2.3 ct', 210000, false),
      ('Feroza (turquoise), Nishapuri 5 ct', 35000, false), ('Lapis lazuli, Afghan 12 ct', 18000, false),
      ('Aqeeq (agate), Yemeni 8 ct', 9500, false),          ('Peridot (zabarjad) 3.4 ct', 28000, false),
      ('Ruby (yaqoot) 1.6 ct', 120000, true),               ('Feroza ring stone 3 ct', 22000, true)
    ) as x(name, price, sell)
  loop
    v_id := pg_temp.add_item('piece', 'GEM', t.name, 'other', null, null, 0, 'per_gram', 0, 0, t.price, 1, null,
                             (v_today - pg_temp.rnd(62, 128)::int) + time '13:00', u_ibrahim, 'Gem dealer, Kandahari Bazaar');
    if t.sell then pool := pool || v_id; end if;
  end loop;

  -- Bulk (sold by count, fixed price each)
  bulk := array[
    pg_temp.add_item('bulk', 'RNG', 'Silver ring with aqeeq', 'silver', '925', null, 0, 'per_gram', 0, 0, 3500, 30, 8,
                     (v_today - 90) + time '12:00', u_zahid, 'Kandahari Workshop'),
    pg_temp.add_item('bulk', 'NSP', 'Silver nose pin, design 3', 'silver', '925', null, 0, 'per_gram', 0, 0, 1500, 40, 10,
                     (v_today - 88) + time '12:00', u_zahid, 'Kandahari Workshop'),
    pg_temp.add_item('bulk', 'NSP', 'Gold laung (nose pin) 22K', 'gold', '22K', null, 0, 'per_gram', 0, 0, 18500, 12, 4,
                     (v_today - 85) + time '12:00', u_naseeb, 'Karigar Bashir'),
    pg_temp.add_item('bulk', 'ANK', 'Silver anklet pair (payal)', 'silver', '925', null, 0, 'per_gram', 0, 0, 6500, 10, 4,
                     (v_today - 80) + time '12:00', u_wahid, 'Kandahari Workshop'),
    pg_temp.add_item('bulk', 'ANK', 'Silver anklet with bells', 'silver', '925', null, 0, 'per_gram', 0, 0, 8500, 6, 4,
                     (v_today - 80) + time '12:30', u_wahid, 'Kandahari Workshop')
  ];

  -- Clients ---------------------------------------------------------------------
  with c as (
    insert into public.clients (full_name, phone, address, city, birthday, anniversary, notes, created_by, created_at)
    select x.name, '030000001' || lpad(x.n::text, 2, '0'), x.addr, 'Quetta',
           case when x.bday is not null then (v_today + x.bday) - (x.age || ' years')::interval end,
           x.anniv, x.notes, u_naseeb, now() - ((150 - x.n * 7) || ' days')::interval
    from (values
      (1,  'Bibi Zarghuna',      'Satellite Town',          3,    41, null::date, 'Prefers 22K; ring size 7'),
      (2,  'Mahrukh Baloch',     'Jinnah Town',             null, 29, null,       'Bridal set customer'),
      (3,  'Haji Abdul Qadir',   'Samungli Road',           null, 63, null,       'Buys gold biscuits'),
      (4,  'Shazia',       'Shahbaz Town',            5,    35, null,       null),
      (5,  'Noor Jahan',         'Pashtunabad',             null, 52, null,       'Pays in instalments'),
      (6,  'Gul Bano',           'Sariab Road',             null, 47, null,       null),
      (7,  'Sardar Akbar Khan',  'Airport Road',            null, 58, null,       'Likes feroza and aqeeq rings'),
      (8,  'Rukhsana Durrani',   'Chiltan Housing',         40,   38, null,       null),
      (9,  'Malik Naseer Ahmed', 'Arbab Karam Khan Road',   null, 50, null,       'Corporate gifts at Eid'),
      (10, 'Saima',     'Brewery Road',            null, 26, null,       'Wedding in two months')
    ) as x(n, name, addr, bday, age, anniv, notes)
    returning id
  )
  select array_agg(id) into clients from c;
  update public.clients set anniversary = v_today + 2 - interval '12 years' where phone = '03000000105';

  -- 49 sales over the last 60 days (the last 3 today); the 50th is an exchange below ------
  pool := array(select unnest(pool) order by random());
  for i in 1 .. 49 loop
    v_day := case when i >= 47 then 0 else 59 - floor((i - 1) * 59.0 / 46)::int end;
    v_when := case when v_day = 0
                then now() - ((51 - i) * 40 + floor(random() * 20)) * interval '1 minute'
                else (v_today - v_day) + time '11:00' + floor(random() * 540) * interval '1 minute' end;
    v_by := sellers[1 + floor(random() * array_length(sellers, 1))::int];
    v_client := case when random() < 0.72 then clients[1 + floor(random() * 10)::int] end;

    if i in (7, 32) then                         -- bulk-only sales
      v_items := array[bulk[1 + floor(random() * 5)::int]]; v_qtys := array[1 + floor(random() * 3)::int];
    elsif i % 8 = 3 then                         -- two pieces
      v_items := array[pool[p], pool[p + 1]]; v_qtys := array[1, 1]; p := p + 2;
    else
      v_items := array[pool[p]]; v_qtys := array[1]; p := p + 1;
    end if;
    if i % 10 = 5 then                           -- add a small bulk item
      v_items := v_items || bulk[2 + floor(random() * 2)::int]; v_qtys := v_qtys || 1;
    end if;

    v_plan := case
      when v_client is not null and random() < 0.22 then 'credit'
      when random() < 0.15 then 'old_gold'
      when random() < 0.25 then 'split'
      when random() < 0.25 then 'card'
      when random() < 0.20 then 'bank'
      else 'cash' end;

    v_sale := pg_temp.sell(v_when, v_by, v_client, v_items, v_qtys, pg_temp.rnd(0, 4, 1), v_plan);
    if v_plan = 'credit' then credit_sales := credit_sales || v_sale; end if;
  end loop;

  -- Some credit customers came back to pay (a few still owe) -----------------------
  for i in 1 .. coalesce(array_length(credit_sales, 1), 0) loop
    select b.balance, s.created_at into v_bal, v_when
    from public.sale_balances b join public.sales s on s.id = b.sale_id where b.sale_id = credit_sales[i];
    v_when := v_when + (5 + floor(random() * 15)) * interval '1 day';
    if i % 3 <> 0 and v_when < now() and v_bal > 0 then
      insert into public.payments (sale_id, client_id, method, amount, received_by, created_at)
      select id, client_id, 'cash', case when i % 2 = 0 then v_bal else round(v_bal / 2 / 1000) * 1000 end,
             sellers[1 + floor(random() * 3)::int], v_when
      from public.sales where id = credit_sales[i];
    end if;
  end loop;

  -- Safekeeping (amanat) -----------------------------------------------------------
  -- (a) gold bought here and left with the shop: the client's gold-biscuit / coin purchases
  create temp table tmp_custody (n serial, client_id uuid, sale_id uuid, at timestamptz, note text,
                                 items jsonb, returned_after interval, by_user uuid) on commit drop;
  insert into tmp_custody (client_id, sale_id, at, note, items, returned_after, by_user)
  select s.client_id, s.id, s.created_at + interval '5 minutes', 'Bought here; client asked us to keep it',
         jsonb_agg(jsonb_build_object('description', si.item_name, 'metal', si.metal, 'purity', si.purity,
                                      'qty', si.qty, 'gross_weight_g', i.gross_weight_g, 'item_id', si.item_id)),
         null, s.sold_by
  from public.sales s
  join public.sale_items si on si.sale_id = s.id
  join public.items i on i.id = si.item_id
  join public.categories c on c.id = i.category_id and c.tag_prefix = 'GLD'
  where s.client_id is not null
  group by s.id, s.client_id, s.created_at, s.sold_by;

  -- (b) clients' own gold deposited for safekeeping; two have been collected since
  insert into tmp_custody (client_id, sale_id, at, note, items, returned_after, by_user) values
    (clients[3], null, now() - interval '52 days', 'Family gold kept during house move',
     '[{"description":"Gold biscuit 10 tola","metal":"gold","purity":"24K","qty":1,"gross_weight_g":116.64},
       {"description":"Gold coins","metal":"gold","purity":"24K","qty":5,"gross_weight_g":10}]', interval '30 days', u_ismail),
    (clients[2], null, now() - interval '41 days', 'Mother''s bridal set, kept until the wedding',
     '[{"description":"Old bridal set (necklace, earrings, tikka)","metal":"gold","purity":"22K","qty":1,"gross_weight_g":86.4}]',
     null, u_naseeb),
    (clients[7], null, now() - interval '27 days', null,
     '[{"description":"Kara pair","metal":"gold","purity":"21K","qty":2,"gross_weight_g":22.1},
       {"description":"Silver bar","metal":"silver","purity":"999","qty":1,"gross_weight_g":500}]', interval '12 days', u_ibrahim),
    (clients[10], null, now() - interval '9 days', 'Dowry jewellery, to collect after the wedding',
     '[{"description":"Bangles","metal":"gold","purity":"22K","qty":6,"gross_weight_g":11.2},
       {"description":"Necklace, Balochi design","metal":"gold","purity":"22K","qty":1,"gross_weight_g":41.75}]', null, u_wahid);

  for t in select * from tmp_custody order by at loop
    insert into public.custody_counters as c (year, last_no)
    values (extract(year from (t.at at time zone 'Asia/Karachi'))::int, 1)
    on conflict (year) do update set last_no = c.last_no + 1 returning last_no into v_cno;
    v_id := gen_random_uuid();
    insert into public.custody_receipts (id, receipt_no, client_id, sale_id, note, received_by, received_at)
    values (v_id, 'AMN-' || extract(year from (t.at at time zone 'Asia/Karachi'))::int || '-' || lpad(v_cno::text, 5, '0'),
            t.client_id, t.sale_id, t.note, t.by_user, t.at);
    insert into public.custody_items (receipt_id, description, metal, purity, qty, gross_weight_g, item_id, sort_order)
    select v_id, x ->> 'description', x ->> 'metal', x ->> 'purity', (x ->> 'qty')::int,
           (x ->> 'gross_weight_g')::numeric, (x ->> 'item_id')::uuid, ord::int
    from jsonb_array_elements(t.items) with ordinality as e(x, ord);
    if t.returned_after is not null then
      update public.custody_receipts
        set status = 'returned', returned_by = u_zahid, returned_at = t.at + t.returned_after,
            returned_to = (select full_name from public.clients where id = t.client_id), returned_note = 'Original receipt returned'
        where id = v_id;
    end if;
  end loop;

  -- Today, through the real functions, signed in as Ismail Shah -------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_ismail, 'role', 'authenticated')::text, true);

  -- (a) bought a used bridal set (to stock, with its parts) and an old chain for melting
  perform public.buy_from_client(
    clients[5],
    jsonb_build_array(
      jsonb_build_object('description', 'Used bridal set', 'name', 'Bridal set, pre-owned (Noor Jahan)',
        'metal', 'gold', 'purity', '22K', 'gross_weight_g', 92.4, 'stone_weight_g', 5.1,
        'rate_per_g', floor(pg_temp.rate_on('gold', '22K', v_today) * 0.97), 'deduction_pct', 4,
        'destination', 'stock', 'category_id', (select id from public.categories where tag_prefix = 'SET'),
        'making_type', 'per_gram', 'making_charge', 1200, 'stone_charge', 25000,
        'components', jsonb_build_array(
          jsonb_build_object('kind', 'necklace', 'description', 'Necklace', 'gross_weight_g', 48.2),
          jsonb_build_object('kind', 'earrings', 'description', 'Earrings pair', 'gross_weight_g', 16.9),
          jsonb_build_object('kind', 'bangle', 'description', 'Bangles', 'qty', 2, 'gross_weight_g', 22.6),
          jsonb_build_object('kind', 'ring', 'description', 'Ring', 'gross_weight_g', 4.7))),
      jsonb_build_object('description', 'Broken chain', 'metal', 'gold', 'purity', '21K', 'gross_weight_g', 7.8,
        'rate_per_g', floor(pg_temp.rate_on('gold', '21K', v_today) * 0.97), 'deduction_pct', 3, 'destination', 'melt')),
    'cash', null, 'CNIC seen', 'Client selling her mother''s set');

  -- (b) exchange: a client brings back a ring bought earlier and takes another piece
  select s.id, si.id, s.client_id into v_sale, v_id, v_client
  from public.sales s
  join public.sale_items si on si.sale_id = s.id
  join public.items i on i.id = si.item_id and i.tracking = 'piece'
  join public.categories c on c.id = i.category_id and c.tag_prefix = 'RNG'
  join public.sale_balances b on b.sale_id = s.id and b.balance = 0
  where s.client_id is not null and (select count(*) from public.sale_items x where x.sale_id = s.id) = 1
  order by s.created_at limit 1;
  v_plan := (public.return_sale_items(v_sale, jsonb_build_array(jsonb_build_object('sale_item_id', v_id)),
                                      'exchange', 'Size too small; exchanged for another piece', 2)) ->> 'return_no';
  select exchange_amount into v_bal from public.sale_returns where return_no = v_plan;
  -- the client picks a somewhat dearer piece and pays the difference in cash
  select i.id, pg_temp.price_on(i, v_today) into v_id, f
  from public.items i join public.categories c on c.id = i.category_id
  where i.status = 'in_stock' and i.tracking = 'piece' and c.tag_prefix in ('RNG', 'EAR', 'PND', 'BRC', 'CHN')
    and pg_temp.price_on(i, v_today) between v_bal * 1.05 and v_bal * 2
  order by pg_temp.price_on(i, v_today) limit 1;
  if v_id is null then
    v_id := pool[p];  -- fallback: the last unsold piece
    select pg_temp.price_on(i, v_today) into f from public.items i where i.id = v_id;
  end if;
  perform public.create_sale(
    jsonb_build_array(jsonb_build_object('item_id', v_id, 'final_price', f)),
    case when f > v_bal
      then jsonb_build_array(jsonb_build_object('method', 'exchange', 'amount', v_bal, 'reference', v_plan),
                             jsonb_build_object('method', 'cash', 'amount', f - v_bal))
      else jsonb_build_array(jsonb_build_object('method', 'exchange', 'amount', f, 'reference', v_plan)) end,
    v_client, 'Exchange against ' || v_plan);
  perform set_config('request.jwt.claims', '', true);

  -- Sanity checks: fail the whole seed rather than leave inconsistent data ----------
  if (select count(*) from public.items where status = 'in_stock' and qty_on_hand > 0) <> 100 then
    raise exception 'expected 100 items in stock, got %', (select count(*) from public.items where status = 'in_stock' and qty_on_hand > 0);
  end if;
  if (select count(*) from public.sales) <> 50 then raise exception 'expected 50 sales'; end if;
  if exists (select 1 from public.items i
             left join (select item_id, sum(qty) s from public.stock_moves group by item_id) m on m.item_id = i.id
             where i.qty_on_hand <> coalesce(m.s, 0)) then
    raise exception 'stock ledger mismatch';
  end if;
  if exists (select 1 from public.sale_balances where balance < 0) then raise exception 'overpaid sale'; end if;
  raise notice 'Quetta demo seeded: % items in stock, % sold pieces, % sales, % clients, % safekeeping receipts',
    (select count(*) from public.items where status = 'in_stock'), (select count(*) from public.items where status = 'sold'),
    (select count(*) from public.sales), (select count(*) from public.clients), (select count(*) from public.custody_receipts);
end
$seed$;
