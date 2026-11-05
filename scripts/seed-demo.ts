// Loads demo data into the linked REAL project through the app's own API, signed
// in as an admin, so every row is validated, tagged, costed and audited.
// Safe to re-run: skips what already exists. Never creates repo-known passwords.
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... pnpm db:remote:seed
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const domain = process.env.VITE_LOGIN_EMAIL_DOMAIN ?? "shop.local";
const login = process.env.ADMIN_EMAIL!;
const password = process.env.ADMIN_PASSWORD!;
if (!url || !anon) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env");

const sb = createClient(url, anon, { auth: { persistSession: false } });
function must<T>(r: { data: T; error: unknown }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${(r.error as { message?: string }).message ?? JSON.stringify(r.error)}`);
  if (r.data === null || r.data === undefined) throw new Error(`${what}: no data returned`);
  return r.data as NonNullable<T>;
}

const email = login.includes("@") ? login : `${login}@${domain}`;
const signIn = await sb.auth.signInWithPassword({ email, password });
if (signIn.error) throw new Error(`admin sign-in: ${signIn.error.message}`);
const { data: me } = await sb.from("profiles").select("role").single();
if (me?.role !== "admin") throw new Error("That account is not an admin");

// 1. Shop settings, only if untouched
const settings = must(await sb.from("shop_settings").select("shop_name").eq("id", 1).single(), "settings");
if (settings.shop_name === "My Jewelers") {
  must(await sb.from("shop_settings").update({ shop_name: "Demo Jewelers", address: "Main Bazaar, Lahore", phone: "0300-0000000" }).eq("id", 1), "settings");
  console.log("✔ shop settings: Demo Jewelers");
} else console.log("• shop settings already customised — left as is");

// 2. Today's rates
const rates: [string, string, number][] = [
  ["gold", "24K", 23500], ["gold", "22K", 21550], ["gold", "21K", 20560], ["gold", "18K", 17625],
  ["silver", "999", 280], ["silver", "925", 260],
];
must(await sb.rpc("set_metal_rates", { p_rates: rates.map(([metal, purity, rate_per_g]) => ({ metal, purity, rate_per_g })) }), "rates");
const rate = new Map(rates.map(([m, p, r]) => [`${m}:${p}`, r]));
console.log("✔ today's metal rates set");

// 3. Stock
const cats = new Map((must(await sb.from("categories").select("id, name"), "categories") ?? []).map((c) => [c.name, c.id]));
const existing = must(await sb.from("items").select("id").limit(1), "items");
const created = new Map<string, string>();
type Row = [string, string, string, string, string, number | null, number, string, number, number, number | null, number, number | null];
const items: Row[] = [
  ["piece", "Ring", "Ladies ring, floral", "gold", "22K", 4.12, 0, "per_gram", 1800, 0, null, 1, null],
  ["piece", "Ring", "Gents ring, plain band", "gold", "21K", 6.31, 0, "per_gram", 1500, 0, null, 1, null],
  ["piece", "Necklace", "Bridal necklace with kundan", "gold", "22K", 38.45, 3.2, "per_gram", 2500, 45000, null, 1, null],
  ["piece", "Earrings", "Jhumka earrings", "gold", "22K", 9.87, 0.5, "fixed", 12000, 3000, null, 1, null],
  ["piece", "Bangle", "Plain bangle", "gold", "21K", 11.66, 0, "per_gram", 1200, 0, null, 1, null],
  ["piece", "Chain", "Rope chain 20 inch", "gold", "18K", 7.25, 0, "per_gram", 1000, 0, null, 1, null],
  ["bulk", "Nose pin", "Silver nose pin, design 3", "silver", "925", null, 0, "per_gram", 0, 0, 1500, 24, 5],
  ["bulk", "Anklet", "Silver anklet pair", "silver", "925", null, 0, "per_gram", 0, 0, 6500, 4, 5],
];
if (existing.length) console.log("• stock already present — skipped");
else {
  for (const [tracking, cat, name, metal, purity, gross, stone, making_type, making, stone_charge, fixed, qty, low] of items) {
    let cost: number;
    if (fixed === null) {
      const net = gross! - stone;
      const price = net * rate.get(`${metal}:${purity}`)! + (making_type === "fixed" ? making : making * net) + stone_charge;
      cost = Math.round(price * 0.85);
    } else cost = Math.round(fixed * 0.6);
    const r = must(await sb.rpc("receive_stock", {
      p_item: { tracking, category_id: cats.get(cat), name, metal, purity, gross_weight_g: gross, stone_weight_g: stone,
                making_type, making_charge: making, stone_charge, fixed_price: fixed, low_stock_at: low },
      p_qty: qty,
      p_cost: { cost_amount: cost, supplier: "Karigar Bashir" },
    }), name) as unknown as { item_id: string; tag: string };
    created.set(name, r.item_id);
    console.log(`✔ ${r.tag.padEnd(10)} ${name}`);
  }
}

// 4. Clients
const today = new Date();
const bday = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate() + 3).toISOString().slice(0, 10);
const clientIds = new Map<string, string>();
const demoClients: { full_name: string; phone: string; city: string; birthday?: string }[] = [
  { full_name: "Ayesha Siddiqui", phone: "03211234567", city: "Lahore", birthday: bday },
  { full_name: "Bilal Ahmed", phone: "03331234567", city: "Lahore" },
];
for (const c of demoClients) {
  const found = must(await sb.from("clients").select("id").eq("phone", c.phone), "client lookup");
  if (found.length) { clientIds.set(c.full_name, found[0].id); console.log(`• client ${c.full_name} exists`); continue; }
  const row = must(await sb.from("clients").insert(c).select("id").single(), c.full_name);
  clientIds.set(c.full_name, row.id);
  console.log(`✔ client ${c.full_name}`);
}

// 5. One part-credit sale (only on a fresh seed)
const ringId = created.get("Ladies ring, floral");
if (ringId) {
  const ring = must(await sb.from("items").select("id, suggested_price").eq("id", ringId).single(), "ring") as unknown as { id: string; suggested_price: number };
  const sale = must(await sb.rpc("create_sale", {
    p_client_id: clientIds.get("Ayesha Siddiqui"),
    p_lines: [{ item_id: ring.id, final_price: Number(ring.suggested_price) - 2000 }],
    p_payments: [{ method: "cash", amount: 60000 }],
    p_note: "Demo sale — void it from the invoice page if not needed",
  }), "sale") as unknown as { invoice_no: string; total: number; paid: number; balance: number };
  console.log(`✔ sample sale ${sale.invoice_no}: total ${sale.total}, paid ${sale.paid}, balance due ${sale.balance}`);
}

// 6. Demo staff login with a random password
const ali = must(await sb.from("profiles").select("id").eq("username", "ali"), "staff lookup");
if (ali.length) console.log("• staff user ali exists");
else {
  const words = ["gold", "ruby", "pearl", "jade", "opal"];
  const pw = `${words[randomInt(words.length)]}-${randomInt(1000, 10000)}-${randomBytes(3).toString("base64url")}`;
  const { error } = await sb.functions.invoke("admin-users/create", {
    body: { username: "ali", full_name: "Ali Khan", role: "staff", password: pw, phone: "03007654321",
            hr: { joined_on: "2024-03-15", monthly_salary: 45000 } },
  });
  if (error) throw new Error(`staff user: ${error.message} (is the admin-users function deployed?)`);
  console.log(`✔ staff login → username: ali   password: ${pw}`);
}
await sb.auth.signOut();
