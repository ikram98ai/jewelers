-- pgTAP: run with `pnpm db:test` (supabase test db). Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 't_admin@shop.local'),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 't_staff@shop.local'),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 't_gone@shop.local');
insert into public.profiles (id, username, full_name, role, active) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 't_admin', 'Test Admin', 'admin', true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 't_staff', 'Test Staff', 'staff', true),
  ('cccccccc-0000-0000-0000-000000000003', 't_gone',  'Former Staff', 'staff', false);
insert into public.employee_hr (profile_id, monthly_salary) values ('bbbbbbbb-0000-0000-0000-000000000002', 40000);

insert into public.metal_rates (metal, purity, rate_per_g, effective_on, set_by)
values ('gold', '22K', 20000, public.shop_today(), 'aaaaaaaa-0000-0000-0000-000000000001')
on conflict (metal, purity, effective_on) do update set rate_per_g = 20000;

insert into public.items (id, tracking, category_id, name, metal, purity, gross_weight_g, stone_weight_g,
                          making_type, making_charge, stone_charge, qty_on_hand, created_by)
select 'dddddddd-0000-0000-0000-000000000001', 'piece', c.id, 'Test ring', 'gold', '22K', 5.500, 0.500,
       'per_gram', 1000, 2000, 1, 'aaaaaaaa-0000-0000-0000-000000000001'
from public.categories c where c.tag_prefix = 'RNG';
insert into public.items (id, tracking, category_id, name, metal, purity, fixed_price, qty_on_hand, created_by)
select 'dddddddd-0000-0000-0000-000000000002', 'bulk', c.id, 'Test anklet', 'silver', '925', 5000, 3,
       'aaaaaaaa-0000-0000-0000-000000000001'
from public.categories c where c.tag_prefix = 'ANK';
insert into public.stock_moves (item_id, type, qty, created_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'receive', 1, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002', 'receive', 3, 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.item_costs (item_id, cost_amount) values ('dddddddd-0000-0000-0000-000000000001', 100000);
insert into public.clients (id, full_name, phone, created_by)
values ('eeeeeeee-0000-0000-0000-000000000001', 'Test Client', '0300-111 2222', 'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'every public table has RLS enabled'
);
select is(
  (select tag from public.items where id = 'dddddddd-0000-0000-0000-000000000001') ~ '^RNG-[0-9]{5}$',
  true, 'piece items get a generated tag'
);
select is((select phone from public.clients where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  '03001112222', 'client phones are normalized to digits');
-- net 5.0 g * 20000 + making 1000/g * 5.0 + stones 2000 = 107000
select is(public.price_for('gold', '22K', 5.0, 'per_gram', 1000, 2000, null), 107000::numeric,
  'pricing formula: net weight x rate + making + stones');
select throws_ok($$ update public.audit_log set action = 'insert' $$, 'P0001', null, 'audit_log is append-only');
select throws_ok($$ delete from public.stock_moves $$, 'P0001', null, 'stock_moves is append-only');

-- ---------------------------------------------------------------------------
-- Anonymous: nothing at all
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.items $$, '42501', null, 'anon cannot read items');
select throws_ok($$ select public.dashboard_summary() $$, '42501', null, 'anon cannot call RPCs');
reset role;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select isnt_empty($$ select * from public.items $$, 'staff can read items');
select is_empty($$ select * from public.item_costs $$, 'staff cannot read costs');
select is_empty($$ select * from public.employee_hr $$, 'staff cannot read HR data');
select is_empty($$ select * from public.salary_payments $$, 'staff cannot read salaries');
select is_empty($$ select * from public.audit_log $$, 'staff cannot read the audit log');
select throws_ok($$ update public.items set status = 'sold' $$, '42501', null, 'staff cannot write item status');
select throws_ok($$ update public.items set qty_on_hand = 99 $$, '42501', null, 'staff cannot write item qty');
select throws_ok(
  $$ insert into public.stock_moves (item_id, type, qty, created_by)
     values ('dddddddd-0000-0000-0000-000000000001', 'adjust', 1, 'bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501', null, 'staff cannot insert stock moves directly');
select throws_ok($$ update public.profiles set role = 'admin' $$, '42501', null, 'staff cannot change roles');
select throws_ok($$ select public.set_metal_rates('[{"metal":"gold","purity":"22K","rate_per_g":1}]') $$,
  '42501', null, 'staff cannot set rates');
select throws_ok($$ select public.item_margin('dddddddd-0000-0000-0000-000000000001') $$,
  '42501', null, 'staff cannot read margins');
select is((public.dashboard_summary() -> 'admin'), 'null'::jsonb, 'staff dashboard has no admin section');

-- Walk-in cannot leave a balance
select throws_like(
  $$ select public.create_sale('[{"item_id":"dddddddd-0000-0000-0000-000000000001","final_price":100000}]',
                               '[{"method":"cash","amount":50000}]') $$,
  '%CREDIT_NEEDS_CLIENT%', 'walk-in sale must be fully paid');
select throws_like(
  $$ select public.create_sale('[{"item_id":"dddddddd-0000-0000-0000-000000000001","final_price":100000}]',
                               '[{"method":"cash","amount":150000}]') $$,
  '%OVERPAID%', 'payments cannot exceed the total');

-- Credit sale with cash + old gold: 3 g * 18000 * (1 - 2%) = 52920
select lives_ok(
  $$ select public.create_sale(
       '[{"item_id":"dddddddd-0000-0000-0000-000000000001","final_price":105000},
         {"item_id":"dddddddd-0000-0000-0000-000000000002","qty":2,"final_price":9500}]',
       '[{"method":"cash","amount":40000},
         {"method":"old_gold","old_gold":{"gross_weight_g":3,"purity":"22K","rate_per_g":18000,"deduction_pct":2}}]',
       'eeeeeeee-0000-0000-0000-000000000001') $$,
  'staff can sell to a client on part credit with old gold');
select is((select status from public.items where id = 'dddddddd-0000-0000-0000-000000000001'), 'sold', 'piece is now sold');
select is((select qty_on_hand from public.items where id = 'dddddddd-0000-0000-0000-000000000002'), 1, 'bulk qty decremented');
select is((select balance from public.client_balances where client_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  (114500 - 40000 - 52920)::numeric, 'client balance = total - cash - old gold value');
select throws_like(
  $$ select public.create_sale('[{"item_id":"dddddddd-0000-0000-0000-000000000001","final_price":1}]',
                               '[{"method":"cash","amount":1}]') $$,
  '%ITEM_UNAVAILABLE%', 'a sold piece cannot be sold again');
select throws_ok(
  $$ select public.void_sale((select id from public.sales where client_id = 'eeeeeeee-0000-0000-0000-000000000001'), 'test reason') $$,
  '42501', null, 'staff cannot void a sale');

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select isnt_empty($$ select * from public.item_costs $$, 'admin can read costs');
select is(
  (select count(*)::int from public.set_metal_rates('[{"metal":"gold","purity":"21k","rate_per_g":19000}]')),
  1, 'admin can set rates (purity normalized)');
select is((select rate_per_g from public.metal_rates where purity = '21K' and effective_on = public.shop_today()),
  19000::numeric, 'rate stored for shop today');
select isnt_empty($$ select * from public.search_items('Test ring', p_status => null) $$, 'text search does not break on numeric cast');
select isnt_empty($$ select * from public.search_items('5.0', p_status => null) $$, 'weight search finds a 5.000 g piece');
select is(
  (public.import_items('[{"category":"ring","name":"Imported ring","metal":"gold","purity":"22K","gross_weight_g":3.5,"cost_amount":50000}]') ->> 'imported')::int,
  1, 'admin can import stock (category by name, case-insensitive)');
select throws_like(
  $$ select public.import_items('[{"category":"Nope","name":"x","metal":"gold","purity":"22K","gross_weight_g":1}]') $$,
  '%row 1%unknown category%', 'import rejects a bad row with its row number');
select lives_ok($$ select public.start_stock_check() $$, 'admin can start a stock check');
select is(
  (public.stock_check_scan((select id from public.stock_checks where status = 'open'),
                           (select tag from public.items where id = 'dddddddd-0000-0000-0000-000000000001')) ->> 'already_seen')::boolean,
  false, 'scanning a piece marks it found');
select is_empty(
  $$ select 1 from public.stock_check_missing((select id from public.stock_checks where status = 'open'))
     where item_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'a scanned piece is not listed as missing');
select lives_ok(
  $$ select public.void_sale((select id from public.sales where client_id = 'eeeeeeee-0000-0000-0000-000000000001'), 'customer changed mind') $$,
  'admin can void a sale');
select is((select status from public.items where id = 'dddddddd-0000-0000-0000-000000000001'), 'in_stock', 'void returns the piece to stock');
select is((select balance from public.client_balances where client_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  0::numeric, 'void sale no longer counts toward the balance');

-- ---------------------------------------------------------------------------
-- Deactivated user: valid JWT, but sees nothing
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';
select is_empty($$ select * from public.items $$, 'deactivated user cannot read data');
reset role;

-- ---------------------------------------------------------------------------
-- Ledger integrity: qty_on_hand always equals the sum of stock moves
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select i.id from public.items i
     left join (select item_id, sum(qty) s from public.stock_moves group by item_id) m on m.item_id = i.id
     where i.qty_on_hand <> coalesce(m.s, 0) $$,
  'qty_on_hand matches the stock-move ledger for every item'
);

select * from finish();
rollback;
