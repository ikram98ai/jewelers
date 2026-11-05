-- Fix: photo uploads were always refused.
-- In the upload policies the bare `name` inside the subquery resolved to items.name
-- (the item's title), not storage.objects.name (the file path), so the folder check
-- could never match. Qualify the column with the policy's table.
drop policy if exists item_photos_upload on storage.objects;
create policy item_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and public.is_active_user()
    and exists (select 1 from public.items i where i.id::text = (storage.foldername(objects.name))[1])
  );

drop policy if exists custody_photos_upload on storage.objects;
create policy custody_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'custody-photos'
    and public.is_active_user()
    and exists (select 1 from public.custody_receipts r
                where r.id::text = (storage.foldername(objects.name))[1] and r.status = 'held')
  );
