# Jewelers

A free web app for one jewelry shop and its staff of about 10: **stock, sales, clients, employees and daily metal rates.**

- **App:** React + TypeScript + Vite + Mantine, a static SPA on **GitHub Pages**.
- **Backend:** **Supabase** free tier. Postgres with Row Level Security is the security boundary; Auth handles logins; Storage holds photos; one Edge Function handles admin user management.
- **Cost:** $0/month. See `docs/operations.md` for the free-tier limits we watch.

## How it is secured (read this before changing anything)

| Rule | Where it's enforced |
|---|---|
| The browser only has the **anon** key. No secret ever ships in the app. | `src/lib/supabase.ts`, a CI check in `deploy.yml` |
| Every table has **RLS**. Anonymous users get nothing. | migrations + `supabase/tests` (CI fails if any table lacks RLS) |
| **Staff can't see** costs, profit, salaries, HR data or the audit log. | admin-only tables/RPCs (`item_costs`, `employee_hr`, `salary_payments`, `audit_log`, `item_margin`, `dashboard_summary.admin`) |
| Stock and money change **only through Postgres functions** in one transaction. Clients can't write `status`, `qty_on_hand`, `stock_moves`, `sales` or `payments`. | revoked grants + `receive_stock`, `adjust_stock`, `create_sale`, `add_payment`, `void_sale` |
| A piece can't be sold twice. | row locks in `create_sale` (test: *a sold piece cannot be sold again*) |
| Nothing is deleted. Ledgers and the audit log are append-only. | `prevent_update_delete` triggers; void instead of delete |
| Only active admins can create, reset or deactivate users. The **service-role key lives only in the Edge Function.** | `supabase/functions/admin-users` |
| Deactivated staff see nothing, even with a still-valid token. | `is_active_user()` in every policy |

## Development

Requirements: Node 22, pnpm. There is no local database; the app talks to the Supabase project in `.env`.

```bash
pnpm install
pnpm exec supabase login                                  # once per machine
pnpm exec supabase link --project-ref <your-project-ref>  # once per machine
pnpm dev                                                  # http://127.0.0.1:5174
```

`.env` holds only the public URL and publishable key (see `.env.example`). For experiments, use a second free
Supabase project instead of production: change `.env` and link to it.

### Database commands

| Command | What it does |
|---|---|
| `pnpm db:remote:status` | Show which migrations the real project has |
| `pnpm db:remote:create` | Apply pending migrations to the real project (creates the schema on a new project) |
| `pnpm db:remote:reset` | **Delete all data** in the real project and recreate an empty schema. You must type the project ref; the seed never runs here. |
| `pnpm db:remote:admin <username> "<Full Name>" [--email you@x.com]` | Create, or after a reset restore, the first admin. Reads the service key from your logged-in CLI; it is never printed. |
| `ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm db:remote:seed` | Load demo stock, clients, a sale and a staff login into the real project through the app API (random password) |

The `db:remote:*` commands need `pnpm exec supabase login` and `pnpm exec supabase link --project-ref <ref>` once per machine. Take a backup before `db:remote:reset`.

| Other commands | What it does |
|---|---|
| `pnpm db:types` | Regenerate `src/lib/database.types.ts` from the linked project after a schema change |
| `pnpm typecheck && pnpm lint && pnpm test` | What CI runs on the app |

Schema changes: `pnpm exec supabase migration new <name>`, write SQL, push a branch (CI runs the pgTAP tests on a throwaway database), then `pnpm db:remote:create` and `pnpm db:types`. **Never edit the production schema in the dashboard.**

## Deploying

Push to `main`. `.github/workflows/deploy.yml` runs CI, applies migrations, deploys the Edge Function, then builds and publishes to GitHub Pages. First-time setup: **`docs/setup.md`**.

## Project layout

```
src/                     React app (pages/, components/, lib/)
supabase/migrations/     schema, RLS, business functions (the source of truth)
supabase/functions/      admin-users and metal-spot Edge Functions
supabase/tests/          pgTAP tests (run in CI)
scripts/                 create-first-admin (run once, locally)
ops/backup-repo/         copy into a PRIVATE repo for nightly encrypted backups
docs/                    setup and operations runbooks
```
