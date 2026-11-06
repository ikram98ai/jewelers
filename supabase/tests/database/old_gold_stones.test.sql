-- pgTAP: old gold taken as payment is valued on net weight. Rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a5', 'authenticated', 'authenticated', 't5_admin@shop.local');
insert into public.profiles (id, username, full_name, role) values
  ('a0000000-0000-0000-0000-0000000000a5', 't5_admin', 'T5 Admin', 'admin');
insert into public.clients (id, full_name, phone, created_by) values
  ('c0000000-0000-0000-0000-0000000000c5', 'Client Five', '03009990005', 'a0000000-0000-0000-0000-0000000000a5');
insert into public.items (id, tracking, category_id, name, metal, fixed_price, qty_on_hand, created_by)
select x.id::uuid, 'piece', c.id, 'T5 ring', 'other', 100000, 1, 'a0000000-0000-0000-0000-0000000000a5'
from public.categories c, (values ('d0000000-0000-0000-0000-0000000000e1'), ('d0000000-0000-0000-0000-0000000000e2')) x(id)
where c.tag_prefix = 'RNG';
insert into public.stock_moves (item_id, type, qty, created_by)
select id, 'receive', 1, 'a0000000-0000-0000-0000-0000000000a5' from public.items where id::text like 'd0000000-0000-0000-0000-0000000000e%';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a5","role":"authenticated"}';

select throws_like(
  $$ select public.create_sale('[{"item_id":"d0000000-0000-0000-0000-0000000000e1","final_price":100000}]',
       '[{"method":"old_gold","old_gold":{"gross_weight_g":2,"stone_weight_g":2,"purity":"22K","rate_per_g":20000}}]',
       'c0000000-0000-0000-0000-0000000000c5') $$,
  '%stone weight must be less%', 'stones cannot equal the total weight');
select lives_ok(
  $$ select public.create_sale('[{"item_id":"d0000000-0000-0000-0000-0000000000e2","final_price":100000}]',
       '[{"method":"old_gold","old_gold":{"gross_weight_g":5,"stone_weight_g":1,"purity":"22K","rate_per_g":20000,"deduction_pct":5}}]',
       'c0000000-0000-0000-0000-0000000000c5') $$,
  'old gold with stones is accepted');
select is((select amount from public.payments where client_id = 'c0000000-0000-0000-0000-0000000000c5'),
  76000.00::numeric, 'credit uses net weight: 4 g × 20,000 less 5%');
select is((select (e ->> 'weight_g')::numeric from jsonb_array_elements(public.melt_pool_summary()) e where e ->> 'purity' = '22K'),
  4.000, 'the melt pile counts net weight');
select is((select stone_weight_g from public.old_gold_receipts og join public.payments p on p.id = og.payment_id
           where p.client_id = 'c0000000-0000-0000-0000-0000000000c5'), 1.000::numeric, 'the stone weight is kept on the receipt');

select * from finish();
rollback;
