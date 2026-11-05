# Production setup (one time, about 30 minutes)

## 1. Supabase project
1. Create a free project at supabase.com. Choose the region closest to the shop, and save the **database password** in a password manager.
2. **Authentication → Sign In / Providers**
   - Turn **off** "Allow new users to sign up".
   - Email provider: turn **off** "Confirm email". Usernames map to `<username>@shop.local`, and nothing is ever emailed.
   - Minimum password length: **8**.
3. **Authentication → URL configuration:** Site URL = `https://<org>.github.io/<repo>/`.
4. Note these down (Project Settings → API / Connect):
   - Project ref (the `abcd…` in the URL)
   - Project URL `https://<ref>.supabase.co`
   - **anon / publishable** key (public)
   - **service-role / secret** key: keep it secret, and use it only in steps 4 and 6
   - **Session pooler** connection string (IPv4)

## 2. GitHub repo (public, so Pages is free)
1. **Create a free GitHub organization just for this app** (github.com → + → New organization → Free), e.g. `ikram-jewelers`,
   and create the repo inside it. Pages sites share one browser origin per owner (`<owner>.github.io`), so keeping the
   app away from your personal `<you>.github.io` sites (portfolio, etc.) stops their scripts from reading the app's login session.
   The app will live at `https://<org>.github.io/<repo>/`. Never publish any other Pages site from this organization.
   Then push this repo to it.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Environments → New environment `production`**. Optionally add yourself as a required reviewer for a manual approval gate.
   - Secrets: `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access Tokens) and `SUPABASE_DB_PASSWORD`
   - Variables: `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `LOGIN_EMAIL_DOMAIN`
4. **Settings → Branches:** protect `main` and require the CI checks.

## 3. First deploy
Push to `main` (or run **Actions → Deploy → Run workflow**). The workflow applies all migrations (never the seed), deploys `admin-users` with its secrets, and publishes the app.

## 4. First admin
From your own machine, after `pnpm exec supabase login` and `pnpm exec supabase link --project-ref <ref>`:
```bash
pnpm db:remote:admin owner "Shop Owner"                         # signs in as "owner"
pnpm db:remote:admin ikram "Ikram Ullah" --email you@example.com # or sign in with a real email
```
It reads the service-role key from your logged-in CLI (never printed) and prints a password. Sign in at `https://<org>.github.io/<repo>/`, then change the password under **My account**.

## 5. In the app (as the admin)
1. **Settings:** shop name, address and phone (for invoices), currency, timezone, invoice prefix, old-gold deduction %, and categories.
2. **Metal rates:** enter today's rates. Do this every morning; the app reminds you.
3. **Employees → Add employee** for each staff member. Give them their username and starting password in person.

## 6. Backups (do not skip)
1. Create a **private** repo, e.g. `jewelers-backups`, and copy `ops/backup-repo/*` into it.
2. Generate an encryption key: `age-keygen -o jewelers-backup.key`. Store this file in **two offline places** (owner + developer). It's the only way to read backups.
3. In the private repo, add:
   - Secrets: `SUPABASE_DB_URL` (session pooler URI), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - Variable: `AGE_RECIPIENT` (the `age1…` public key from the key file)
4. Run **Actions → Backup & health → Run workflow** once, and check that the `backups` branch has a file.
5. Do a restore drill within the first week (see `operations.md`).
