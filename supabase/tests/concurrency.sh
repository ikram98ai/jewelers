#!/usr/bin/env bash
# Two sessions try to sell the same piece at the same moment; exactly one must win.
# Runs against the LOCAL stack: `pnpm db:start` first. Used by CI after `supabase test db`.
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PSQL=(psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1)
if ! command -v psql >/dev/null; then
  CONTAINER=$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1)
  PSQL=(docker exec -i "$CONTAINER" psql -U postgres -X -q -At -v ON_ERROR_STOP=1)
fi

STAFF=bbbbbbbb-0000-0000-0000-00000000c0c0
ITEM=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
ITEM=$(echo "$ITEM" | tr "A-Z" "a-z")   # fresh piece every run

"${PSQL[@]}" <<SQL
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '$STAFF', 'authenticated', 'authenticated', 'race@shop.local')
on conflict do nothing;
insert into public.profiles (id, username, full_name, role) values ('$STAFF', 'race_test', 'Race Test', 'staff')
on conflict do nothing;
insert into public.items (id, tracking, category_id, name, metal, fixed_price, qty_on_hand, created_by)
select '$ITEM', 'piece', id, 'Race ring', 'other', 1000, 1, '$STAFF' from public.categories where tag_prefix = 'RNG'
on conflict do nothing;
insert into public.stock_moves (item_id, type, qty, created_by) values ('$ITEM', 'receive', 1, '$STAFF');
SQL

sell() {
  "${PSQL[@]}" <<SQL 2>&1 || true
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$STAFF","role":"authenticated"}';
select pg_sleep(0.2);  -- line both sessions up
select public.create_sale('[{"item_id":"$ITEM","final_price":1000}]', '[{"method":"cash","amount":1000}]')->>'invoice_no';
commit;
SQL
}

sell > /tmp/race_a.txt & sell > /tmp/race_b.txt & wait

wins=$(cat /tmp/race_a.txt /tmp/race_b.txt | grep -c -- '-[0-9]\{4\}-' || true)
losses=$(cat /tmp/race_a.txt /tmp/race_b.txt | grep -c 'ITEM_UNAVAILABLE' || true)
sold_lines=$("${PSQL[@]}" -c "select count(*) from public.sale_items where item_id = '$ITEM'")

echo "wins=$wins losses=$losses sale_lines=$sold_lines"
if [ "$wins" = "1" ] && [ "$losses" = "1" ] && [ "$sold_lines" = "1" ]; then
  echo "PASS: exactly one concurrent sale succeeded"
else
  echo "FAIL"; cat /tmp/race_a.txt /tmp/race_b.txt; exit 1
fi
