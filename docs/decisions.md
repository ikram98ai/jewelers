# Decision log

All design decisions for the Jewelers app. They were recorded in ProjectOS until its decision/note
document types were removed (2026-11-05); this file is now the source of truth. "Unconfirmed" = chosen by the
assistant when the user asked to "go with the recommended options", for the owners to review.

## Original design (2026-11-05)

| # | Decision | Status |
|---|---|---|
| A1 | **Frontend:** React + Vite SPA (TypeScript, Mantine, TanStack Query) on GitHub Pages, HashRouter, deployed by GitHub Actions. | decided |
| A2 | **Backend:** Supabase free tier (Postgres + Auth + Storage + Edge Function). The browser holds only the publishable key; RLS is the security boundary. Turso, Cloudflare D1 and PocketBase were considered. | decided |
| A3 | **Scope:** a pilot that becomes the real system, built to production standards (backups, roles, audit). | decided |
| A4 | **Roles:** Admin (owners: costs, profit, salaries, voids, users) and Staff (sell, receive stock, clients). Sensitive columns are hidden in Postgres, not just in the UI. | decided |
| A5 | **Employees = login users**, one profile per person; deactivated, never deleted. | decided |
| A6 | **Login:** username + password created by an admin (`<username>@shop.local`); real emails also accepted. No self-service reset. | decided |
| A7 | **User management:** in-app Employees screen calling the `admin-users` Edge Function (the only holder of the service-role key; last-admin and self-change guards). | decided |
| A8 | **Stock model:** one `items` table, `piece` (unique tag, exact weight) or `bulk` (quantity, fixed price). | unconfirmed |
| A9 | **Units:** grams in the DB (tola display optional), purity per item, net = gross − stones, configurable currency, shop timezone. | unconfirmed |
| A10 | **Pricing:** daily metal rate × net weight + making (per gram or fixed) + stones, in one SQL function; staff can bargain, discount recorded; sale lines snapshot prices. | unconfirmed |
| A11 | **Costs** in an admin-only `item_costs` table. | unconfirmed |
| A12 | **Stock integrity:** RPC-only writes, append-only `stock_moves` ledger, audit-log triggers, no hard deletes. | unconfirmed |
| A13 | **Photos:** private Storage, compressed to WebP in the browser, signed URLs. | unconfirmed |
| A14 | **Tags:** category prefix + sequence, QR labels, phone-camera scanning. | unconfirmed |
| A15 | **Clients:** keyed by phone; history, balances, birthdays/anniversaries. | unconfirmed |
| A16 | **Sales:** atomic `create_sale` with row locks (no double-selling), split/partial payments incl. old gold, client credit, admin void. | unconfirmed |
| A17 | **Employee data:** public profile + admin-only HR record + salary/advance log. | unconfirmed |
| A18 | **Reports:** role-aware dashboard + CSV exports. | unconfirmed |
| A19 | **UI:** mobile-first, search-first, big touch targets, i18n-ready strings. | unconfirmed |
| A20 | **Backups:** nightly age-encrypted `pg_dump` + weekly photo archive in a separate private GitHub repo; integrity and free-tier checks. | unconfirmed |
| A21 | **Environments:** SQL migrations in git, CI tests (pgTAP, race test), deploy pipeline; never edit prod in the dashboard. | unconfirmed |
| A22 | **Online-only** (no offline mode). | unconfirmed |
| A23 | **Security hardening:** own GitHub organization for Pages (separate origin from personal sites), CSP meta tag, anti-clickjacking guard, public sign-up off, min password 8, precise bundle secret check. | decided |
| Q1 | *Open:* custom orders, repairs and karigar job tracking. | open |

## Added after the shop's requirements (2026-11-05)

| # | Decision | Status | Depends on (ProjectOS) | Design |
|---|---|---|---|---|
| 1 | **Safekeeping (amanat):** separate numbered receipts (`AMN-YYYY-NNNNN`), released only against the matching receipt number. **Any active user may release**, and who, when and to whom is recorded. Held gold never counts as shop stock. | unconfirmed | Sales; Roles | FR-8 |
| 2 | **Sets:** one tagged, priced item, sold whole, with listed parts (kind, qty, weight, photo). Staff add parts; admins edit or remove them. Selling a single part isn't supported. | unconfirmed | Stock model | FR-9 |
| 3 | **Buying from clients:** purchase vouchers (`PUR-…`). Each piece is priced by net weight × buying rate × (1 − deduction%) or an agreed amount, then goes to stock (new tag, cost = price paid) or the melt pile. **Admin only.** | unconfirmed | Cost prices; Stock model | FR-10 |
| 4 | **Returns & exchanges:** line-level returns (`RET-…`) with optional deduction. The credit first settles what's still owed; the rest is refunded (cash/bank) or kept as exchange credit for the same client, spent as payment method `exchange`. A sale with returns can't be voided. **Admin only.** Replaces "returns after the sale day = void + new sale". | unconfirmed | Sales | FR-11 |
| 5 | **No local database:** development points at a Supabase project via `.env` (a second free project is recommended for experiments); CI still builds a throwaway database for the tests. `pnpm db:remote:reseed` = reset → 5 logins via the admin API (random passwords to a private file) → `supabase db query --linked -f supabase/seeds/demo.sql`. A remote reset also clears Supabase Auth; the seed stops if data already exists (the Management API can retry). | decided with user | Environments; Backups | `scripts/db.sh` |
| 6 | **Demo shop data:** Shah & Ibrahim Jewellers, Liaquat Bazaar, Quetta. Owners/admins Ismail Shah and Haji Ibrahim; staff Naseebullah, Abdul Wahid, Zahid Khan. 10 clients, 100 items in stock, 50 sales over 60 days, sets with parts, 7 safekeeping receipts, 1 purchase, 1 exchange. **Metal rates and the shop name are placeholders.** | user's data | — | `supabase/seeds/demo.sql` |
| 7 | **Gold and silver prices:** the Rates page charts the shop's saved rates and embeds a live TradingView chart as a direct iframe, so no third-party script runs next to the login session (the CSP gains only `frame-src` for that host). **Fill live prices** calls the read-only `metal-spot` Edge Function (Gold API spot price, Exchange Rate API daily USD rate) and only fills the form: rates change when an admin presses Save, because saved rates reprice the whole shop. Live figures are world spot prices, so local market rates can differ. Platinum stays manual. Viewing the page contacts TradingView; filling contacts the two feeds from Supabase. | unconfirmed | Metal rates & pricing 0.2.0 | `src/pages/RatesPage.tsx`, `supabase/functions/metal-spot` |
| 8 | **Melt pile and buying defaults:** metal leaves the pile through melt batches (`MLT-…`): melted (weight before and after, so the loss is known) or sold to a refiner or dealer (amount received). Batches can't be edited; a mistake is voided with a reason, which puts the weight back. The melted bar is not added to stock. On a purchase the rate starts at the day's rate and only the deduction comes off: the old-gold deduction setting, or 3% if that is 0. Each piece must be marked stock or melt. | unconfirmed | Buying from clients | FR-10 |
