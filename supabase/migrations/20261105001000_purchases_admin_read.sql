-- Purchase vouchers reveal what the shop paid for a piece, which is its cost.
-- Costs are admin-only (item_costs), so vouchers must be too: staff get no rows.
drop policy if exists purchases_select on public.purchases;
drop policy if exists purchase_items_select on public.purchase_items;
create policy purchases_select on public.purchases
  for select to authenticated using (public.is_admin());
create policy purchase_items_select on public.purchase_items
  for select to authenticated using (public.is_admin());
