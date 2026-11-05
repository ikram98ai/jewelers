#!/usr/bin/env bash
# Database lifecycle commands. Run via pnpm (see package.json "db:*" scripts).
#
#   REMOTE (the linked real project — `supabase link` first)
#     remote:status  show which migrations are applied
#     remote:create  apply pending migrations (creates the schema on a fresh project)
#     remote:reset   DELETE ALL DATA + schema and recreate it empty from migrations
#     remote:seed    load demo stock/clients/a sale/a staff login through the app API
#     remote:reseed  DELETE ALL DATA and load the Quetta shop demo (5 logins, 100 items, 50 sales…)
#     remote:admin   create (or repair) the first admin account
set -euo pipefail
cd "$(dirname "$0")/.."

SB=./node_modules/.bin/supabase
cmd="${1:-help}"; shift || true

ref() { cat supabase/.temp/project-ref 2>/dev/null || true; }
need_link() {
  if [ -z "$(ref)" ]; then
    echo "Not linked to a Supabase project. Run:"
    echo "  pnpm exec supabase login"
    echo "  pnpm exec supabase link --project-ref <your-project-ref>"
    exit 1
  fi
}
confirm_ref() {
  local r; r="$(ref)"
  echo
  echo "  ⚠  $1"
  echo "     Project: $r"
  echo
  read -r -p "  Type the project ref to continue: " answer
  [ "$answer" = "$r" ] || { echo "  Aborted — nothing changed."; exit 1; }
}
service_key() {
  # Read the service-role key from the logged-in CLI, never from a file or the screen.
  "$SB" projects api-keys --project-ref "$(ref)" -o json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const j = JSON.parse(s); const keys = Array.isArray(j) ? j : (j.keys || j.api_keys || []);
      const k = keys.find(k => k.name === "service_role") || keys.find(k => k.type === "secret");
      process.stdout.write(k ? (k.api_key || k.apiKey) : "");
    });'
}

case "$cmd" in
  remote:status) need_link; "$SB" migration list --linked ;;
  remote:create) need_link; "$SB" db push --linked ;;
  remote:reset)
    need_link
    confirm_ref "This DELETES ALL DATA in the real project (stock, sales, clients, employees, rates, audit log)
     and recreates an empty schema from supabase/migrations. Take a backup first (docs/operations.md)."
    # --no-seed: never seed production; demo data goes in via `pnpm db:remote:seed` (random passwords).
    "$SB" db reset --linked --no-seed
    echo
    echo "Schema recreated. Restore access with:  pnpm db:remote:admin <username> \"<Full Name>\" [--email you@example.com]"
    ;;
  remote:seed)
    need_link
    : "${ADMIN_EMAIL:?Set ADMIN_EMAIL (or the admin username) and ADMIN_PASSWORD}"
    : "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD}"
    node --env-file=.env --experimental-strip-types --no-warnings scripts/seed-demo.ts ;;
  remote:reseed)
    need_link
    confirm_ref "This DELETES ALL DATA in the real project and replaces it with the demo shop
     (Ismail Shah & Haji Ibrahim as admins, 3 staff, 10 clients, 100 items, 50 sales, safekeeping, purchases).
     Every existing login without a matching employee is removed."
    key="$(service_key)"
    [ -n "$key" ] || { echo "Could not read the service-role key from the CLI (logged in?)."; exit 1; }
    export SUPABASE_URL="https://$(ref).supabase.co" SUPABASE_SERVICE_ROLE_KEY="$key"
    # A remote reset also clears Supabase Auth, so: reset → logins → data.
    "$SB" db reset --linked --no-seed --yes
    node --experimental-strip-types --no-warnings scripts/reseed-logins.ts upsert
    "$SB" db query --linked -f supabase/seeds/demo.sql
    node --experimental-strip-types --no-warnings scripts/reseed-logins.ts prune
    echo "Done. Sign in with a username above."
    ;;
  remote:admin)
    need_link
    key="$(service_key)"
    [ -n "$key" ] || { echo "Could not read the service-role key from the CLI (logged in?)."; exit 1; }
    SUPABASE_URL="https://$(ref).supabase.co" SUPABASE_SERVICE_ROLE_KEY="$key" \
      node --experimental-strip-types --no-warnings scripts/create-first-admin.ts "$@" ;;

  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    [ "$cmd" = "help" ] || exit 1 ;;
esac
