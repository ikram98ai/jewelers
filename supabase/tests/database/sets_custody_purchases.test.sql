-- pgTAP: set parts, safekeeping, purchases from clients, returns & exchanges. Rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 't2_admin@shop.local'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 't2_staff@shop.local');
insert into public.profiles (id, username, full_name, role) values
  ('a0000000-0000-0000-0000-0000000000a1', 't2_admin', 'T2 Admin', 'admin'),
  ('b0000000-0000-0000-0000-0000000000b2', 't2_staff', 'T2 Staff', 'staff');
-- Own fixtures only: CI's database has no seed data, so give 22K a rate for today.
insert into public.metal_rates (metal, purity, rate_per_g, effective_on, set_by)
values ('gold', '22K', 20000, public.shop_today(), 'a0000000-0000-0000-0000-0000000000a1')
on conflict (metal, purity, effective_on) do update set rate_per_g = excluded.rate_per_g;
insert into public.clients (id, full_name, phone, created_by) values
  ('c0000000-0000-0000-0000-0000000000c1', 'Client One', '03009990001', 'a0000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-0000000000c2', 'Client Two', '03009990002', 'a0000000-0000-0000-0000-0000000000a1');
insert into public.items (id, tracking, category_id, name, metal, fixed_price, qty_on_hand, created_by)
select 'd0000000-0000-0000-0000-0000000000d1', 'piece', id, 'T2 ring', 'other', 100000, 1, 'a0000000-0000-0000-0000-0000000000a1'
from public.categories where tag_prefix = 'RNG';
insert into public.stock_moves (item_id, type, qty, created_by) values
  ('d0000000-0000-0000-0000-0000000000d1', 'receive', 1, 'a0000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------- staff
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select lives_ok($$ insert into public.item_components (item_id, kind, description, gross_weight_g)
                   values ('d0000000-0000-0000-0000-0000000000d1', 'ring', 'Band', 4.2) $$,
  'staff can list a set''s parts');
delete from public.item_components where item_id = 'd0000000-0000-0000-0000-0000000000d1';
select isnt_empty($$ select 1 from public.item_components where item_id = 'd0000000-0000-0000-0000-0000000000d1' $$,
  'staff cannot delete set parts (row security filters the delete)');

select throws_ok(
  $$ select public.buy_from_client('c0000000-0000-0000-0000-0000000000c1',
       '[{"description":"Old ring","metal":"gold","purity":"22K","gross_weight_g":4,"rate_per_g":20000,"destination":"melt"}]') $$,
  '42501', null, 'staff cannot buy from clients');

select lives_ok(
  $$ select public.create_custody('c0000000-0000-0000-0000-0000000000c1',
       '[{"description":"Gold biscuit 1 tola","metal":"gold","purity":"24K","qty":1,"gross_weight_g":11.664}]') $$,
  'staff can issue a safekeeping receipt');
select throws_like(
  $$ select public.release_custody((select id from public.custody_receipts where client_id = 'c0000000-0000-0000-0000-0000000000c1'), 'AMN-0000-99999') $$,
  '%does not match%', 'release needs the matching receipt number');
select lives_ok(
  $$ select public.release_custody(r.id, lower(r.receipt_no), 'Client One') from public.custody_receipts r
     where r.client_id = 'c0000000-0000-0000-0000-0000000000c1' $$,
  'release with the presented receipt number (case-insensitive)');
select throws_like(
  $$ select public.release_custody(r.id, r.receipt_no) from public.custody_receipts r
     where r.client_id = 'c0000000-0000-0000-0000-0000000000c1' $$,
  '%already returned%', 'gold cannot be released twice');
select throws_ok($$ delete from public.custody_receipts $$, '42501', null, 'staff cannot delete receipts');

-- a sale to Client One, then try a staff return
select lives_ok(
  $$ select public.create_sale('[{"item_id":"d0000000-0000-0000-0000-0000000000d1","final_price":100000}]',
                               '[{"method":"cash","amount":100000}]', 'c0000000-0000-0000-0000-0000000000c1') $$,
  'sale for the return test');
select throws_ok(
  $$ select public.return_sale_items((select sale_id from public.sale_items where item_id = 'd0000000-0000-0000-0000-0000000000d1'),
       jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where item_id = 'd0000000-0000-0000-0000-0000000000d1'))),
       'cash', 'test') $$,
  '42501', null, 'staff cannot process returns');

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (public.buy_from_client('c0000000-0000-0000-0000-0000000000c2',
     jsonb_build_array(jsonb_build_object('description','Used kara','metal','gold','purity','22K','gross_weight_g',10,
       'rate_per_g',20000,'deduction_pct',5,'destination','stock',
       'category_id',(select id from public.categories where tag_prefix='BNG'))),
     'cash') ->> 'total')::numeric,
  190000::numeric, 'purchase value = weight × rate × (1 − deduction)');
select is((select ic.cost_amount from public.item_costs ic join public.items i on i.id = ic.item_id where i.name = 'Used kara'),
  190000::numeric, 'bought piece enters stock with its cost');

select is(
  (public.return_sale_items((select sale_id from public.sale_items where item_id = 'd0000000-0000-0000-0000-0000000000d1'),
     jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where item_id = 'd0000000-0000-0000-0000-0000000000d1'))),
     'exchange', 'Wrong size', 2) ->> 'exchange_credit')::numeric,
  98000::numeric, 'return gives exchange credit minus the deduction');
select is((select status from public.items where id = 'd0000000-0000-0000-0000-0000000000d1'), 'in_stock', 'returned piece is back in stock');
select is((select balance from public.sale_balances where sale_id = (select sale_id from public.sale_items where item_id = 'd0000000-0000-0000-0000-0000000000d1' limit 1)),
  0::numeric, 'original sale balance is settled after the return');

select throws_like(
  $$ select public.create_sale(
       jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where name = 'Used kara'), 'final_price', 250000)),
       jsonb_build_array(jsonb_build_object('method','exchange','amount',98000,'reference',(select return_no from public.sale_returns where client_id = 'c0000000-0000-0000-0000-0000000000c1'))),
       'c0000000-0000-0000-0000-0000000000c2') $$,
  '%belongs to another client%', 'exchange credit cannot be used by another client');
select throws_like(
  $$ select public.create_sale(
       jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where name = 'Used kara'), 'final_price', 250000)),
       jsonb_build_array(jsonb_build_object('method','exchange','amount',99000,'reference',(select return_no from public.sale_returns where client_id = 'c0000000-0000-0000-0000-0000000000c1'))),
       'c0000000-0000-0000-0000-0000000000c1') $$,
  '%exchange credit left%', 'cannot spend more exchange credit than given');
-- staff must not see what the shop paid (that is the item's cost)
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is_empty($$ select * from public.purchases $$, 'staff cannot read purchase vouchers');
select is_empty($$ select * from public.purchase_items $$, 'staff cannot read purchase lines (costs)');
reset role;

select throws_ok($$ update public.purchases set total = 1 $$, 'P0001', null, 'purchases are immutable');

select * from finish();
rollback;
