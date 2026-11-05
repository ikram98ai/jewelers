// Logins for the Quetta demo seed (supabase/seeds/demo.sql).
//   upsert  create or update the five logins with fresh random passwords (prints them once)
//   prune   delete every login that has no employee profile (old demo / previous admins)
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (scripts/db.sh reads them from the CLI).
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";

const mode = process.argv[2];
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const domain = process.env.LOGIN_EMAIL_DOMAIN ?? "shop.local";
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PEOPLE = [
  { username: "ismail", name: "Ismail Shah", role: "admin (owner)" },
  { username: "ibrahim", name: "Haji Ibrahim", role: "admin (owner)" },
  { username: "naseeb", name: "Naseebullah", role: "staff" },
  { username: "wahid", name: "Abdul Wahid", role: "staff" },
  { username: "zahid", name: "Zahid Khan", role: "staff" },
];

async function allUsers() {
  const users = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  return users;
}

function password(): string {
  const words = ["gold", "ruby", "pearl", "jade", "opal", "zamurd", "neelam", "feroza"];
  return `${words[randomInt(words.length)]}-${randomInt(1000, 10000)}-${randomBytes(4).toString("base64url")}`;
}

if (mode === "upsert") {
  const existing = await allUsers();
  const rows: string[] = [];
  for (const p of PEOPLE) {
    const email = `${p.username}@${domain}`;
    const pw = password();
    const found = existing.find((u) => u.email?.toLowerCase() === email);
    const { error } = found
      ? await admin.auth.admin.updateUserById(found.id, { password: pw, ban_duration: "none", email_confirm: true })
      : await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { username: p.username } });
    if (error) throw error;
    rows.push(`  ${p.username.padEnd(9)} ${pw.padEnd(24)} ${p.name} — ${p.role}`);
  }
  const text = "Logins (share each in person, then delete this):\n  username  password                 who\n" + rows.join("\n") + "\n";
  const file = process.env.LOGINS_FILE;
  if (file) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, text, { mode: 0o600 });
    console.log(`\nPasswords written to ${file} (readable only by you). Delete it once shared.\n`);
  } else {
    console.log("\n" + text);
  }
} else if (mode === "prune") {
  const { data: profiles, error } = await admin.from("profiles").select("id");
  if (error) throw error;
  const keep = new Set((profiles ?? []).map((p) => p.id));
  for (const u of await allUsers()) {
    if (keep.has(u.id)) continue;
    const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
    if (delErr) throw delErr;
    console.log(`  removed old login ${u.email}`);
  }
} else {
  console.error("usage: reseed-logins.ts upsert|prune");
  process.exit(1);
}
