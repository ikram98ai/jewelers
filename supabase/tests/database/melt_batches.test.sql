-- pgTAP: taking metal off the melt pile (melted or sold), voiding, and who may do it. Rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', 't3_admin@shop.local'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 't3_staff@shop.local');
insert into public.profiles (id, username, full_name, role) values
  ('a0000000-0000-0000-0000-0000000000a3', 't3_admin', 'T3 Admin', 'admin'),
  ('b0000000-0000-0000-0000-0000000000b3', 't3_staff', 'T3 Staff', 'staff');
insert into public.clients (id, full_name, phone, created_by) values
  ('c0000000-0000-0000-0000-0000000000c3', 'Client Three', '03009990003', 'a0000000-0000-0000-0000-0000000000a3');

create function pg_temp.on_pile(p_metal text, p_purity text) returns numeric language sql as $$
  select (e ->> 'weight_g')::numeric from jsonb_array_elements(public.melt_pool_summary()) e
  where e ->> 'metal' = p_metal and e ->> 'purity' = p_purity
$$;
grant execute on function pg_temp.on_pile(text, text) to authenticated;

-- ---------------------------------------------------------------- admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ select public.buy_from_client('c0000000-0000-0000-0000-0000000000c3',
       '[{"description":"Old chain","metal":"gold","purity":"22K","gross_weight_g":12,"stone_weight_g":2,"value":100000,"destination":"melt"},
         {"description":"Old anklet","metal":"silver","purity":"925","gross_weight_g":50,"value":10000,"destination":"melt"}]') $$,
  'admin buys gold and silver for melting');
select is(pg_temp.on_pile('gold', '22K'), 10.000, 'the pile counts net weight');
select is(pg_temp.on_pile('silver', '925'), 50.000, 'silver is its own pile, marked as silver');

select throws_like($$ select public.record_melt('gold', '22K', 10.001, 'melted', 10) $$, '%only%on the pile%', 'cannot take more than the pile holds');
select throws_like($$ select public.record_melt('gold', '18K', 1, 'melted', 1) $$, '%no 18K gold%', 'cannot take from a pile that is not there');
select throws_like($$ select public.record_melt('gold', '22K', 4, 'melted', 4.1) $$, '%weight after melting%', 'melting cannot add weight');
select throws_like($$ select public.record_melt('gold', '22K', 4, 'melted') $$, '%weight after melting%', 'melting needs the weight after');
select throws_like($$ select public.record_melt('gold', '22K', 4, 'sold') $$, '%amount received%', 'a sale needs the amount received');

select lives_ok($$ select public.record_melt('gold', '22K', 4, 'melted', 3.9, null, 'Karigar') $$, 'admin records a melt');
select is(pg_temp.on_pile('gold', '22K'), 6.000, 'melting takes the weight off the pile');
select is((select cost_value from public.melt_batches where note = 'Karigar'), 40000.00::numeric, 'the batch carries its share of what was paid');

select lives_ok($$ select public.record_melt('gold', '22K', 6, 'sold', null, 70000) $$, 'admin sells the rest');
select is(pg_temp.on_pile('gold', '22K'), null, 'an emptied pile disappears');

select throws_like(
  $$ select public.void_melt_batch((select id from public.melt_batches where note = 'Karigar'), '  ') $$,
  '%reason%', 'voiding needs a reason');
select lives_ok(
  $$ select public.void_melt_batch((select id from public.melt_batches where note = 'Karigar'), 'Wrong weight') $$,
  'admin voids a batch');
select is(pg_temp.on_pile('gold', '22K'), 4.000, 'voiding puts the weight back');
select throws_like(
  $$ select public.void_melt_batch((select id from public.melt_batches where note = 'Karigar'), 'Again') $$,
  '%already void%', 'a batch cannot be voided twice');

-- ---------------------------------------------------------------- staff
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($$ select public.record_melt('silver', '925', 1, 'melted', 1) $$, '42501', null, 'staff cannot record a melt');
select is_empty($$ select 1 from public.melt_batches $$, 'staff cannot read melt batches');

select * from finish();
rollback;
