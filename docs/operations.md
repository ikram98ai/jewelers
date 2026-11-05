# Operations runbook

## Daily (shop)
- Admin sets **today's metal rates** each morning. Until then the app shows a banner and prices use yesterday's rate.

## Nightly (automatic, private backup repo)
- **Encrypted database backup** → `backups` branch: 30 daily + 12 monthly kept, always a single commit, so the repo stays small.
- **Health check:** opens a GitHub issue if:
  - any item's `qty_on_hand` ≠ the sum of its stock moves
  - a sold piece has no completed sale
  - the database is over 350 MB, or photo storage is over 700 MB
- The nightly connection also keeps the free project active. Supabase pauses free projects after about a week of inactivity.
- **Weekly:** encrypted photo archive (artifact kept 35 days).

Targets: lose at most **24 h** of data (RPO), back running within **4 h** (RTO).

## Restore (also the monthly drill, into a spare free Supabase project)
```bash
# 1. Get the latest file from the private repo's `backups` branch, then:
age -d -i jewelers-backup.key db-YYYY-MM-DD.tar.gz.age | tar -xz -C restore/
# 2. Point the CLI at a SPARE project (never production for a drill), build the schema, load the data:
pnpm exec supabase link --project-ref <spare-project-ref>
pnpm db:remote:create
psql "<spare project session-pooler URL>" --single-transaction -v ON_ERROR_STOP=1 \
  -c 'SET session_replication_role = replica' -f restore/data.sql
# 3. Spot-check: counts of items / sales / clients look right and staff can log in. Then re-link production:
pnpm exec supabase link --project-ref <production-ref>
```
Real disaster: create a new Supabase project, set `SUPABASE_PROJECT_REF` and the other vars, run the Deploy workflow (it recreates the schema), restore `data.sql` as above against the new project's session pooler URL, re-upload photos, and update the GitHub variables.

## Common admin tasks
| Situation | What to do |
|---|---|
| Employee forgot password | Employees → person → **Reset password**, then tell them in person |
| Employee leaves | Employees → person → **Deactivate** (immediate; history kept) |
| Wrong sale | Sales → invoice → **Void** with a reason (stock returns), then make a new sale |
| Piece missing / damaged | Item → ⋯ → **Adjust / write off** with a reason |
| Piece found again | Item → ⋯ → **Restore** |
| Customer pays later | Client → unpaid invoice → **Add payment** |

## Free-tier limits to watch
| Resource | Limit | Notes |
|---|---|---|
| Database | 500 MB | Text data grows by a few MB per year |
| Storage | 1 GB | ~150 KB per photo; delete photos of long-sold items if needed |
| Egress | 5 GB / month | Photos are cached (1 year) |
| Pausing | ~7 days idle | Daily use + the nightly job prevent it |

Upgrade path: Supabase Pro. No code changes needed; it adds point-in-time recovery and removes pausing.

## Security checklist (quarterly)
- [ ] Supabase Auth: sign-ups still **disabled**
- [ ] No inactive staff still marked active (Employees list)
- [ ] `pnpm db:test` passes; the CI RLS check is green
- [ ] Rotate `SUPABASE_ACCESS_TOKEN`; rotate the service-role key if it may have leaked, and update the backup-repo secret
- [ ] Do a restore drill
