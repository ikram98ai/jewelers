// One-time bootstrap: creates the first admin account in a fresh project.
// Run from YOUR machine only (it uses the service-role key, which never goes in the app):
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
//   pnpm admin:create <username> "<Full Name>" [--email you@example.com]
//
// With --email the admin signs in with that real email address; without it,
// with the username (stored as <username>@<LOGIN_EMAIL_DOMAIN>).
// Prints a generated password. After this, the admin adds everyone else from the app.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const emailIdx = args.indexOf("--email");
const realEmail = emailIdx >= 0 ? args[emailIdx + 1]?.trim().toLowerCase() : undefined;
const [username, fullName] = args.filter((a, i) => !a.startsWith("--") && !(emailIdx >= 0 && i === emailIdx + 1));
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.LOGIN_EMAIL_DOMAIN ?? "shop.local";

if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
if (realEmail !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(realEmail)) throw new Error("--email is not a valid address");
if (!username || !/^[a-z0-9_.]{3,30}$/.test(username) || !fullName) {
  console.error('Usage: pnpm admin:create <username> "<Full Name>" [--email you@example.com]   (username: 3–30 of a-z 0-9 . _)');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
if (count && count > 0 && !process.argv.includes("--force")) {
  console.error("An admin already exists. Add users from the app instead (or pass --force).");
  process.exit(1);
}

const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
const email = realEmail ?? `${username}@${domain}`;

// After `pnpm db:remote:reset` the login may still exist while its profile is gone:
// reuse it (new password, unbanned) instead of failing.
async function findUserId(): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

let userId = await findUserId();
let reused = false;
if (userId) {
  const { error } = await admin.auth.admin.updateUserById(userId, { password, ban_duration: "none", email_confirm: true });
  if (error) throw error;
  reused = true;
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  userId = data.user.id;
}

const { error: pErr } = await admin.from("profiles")
  .upsert({ id: userId, username, full_name: fullName, role: "admin", active: true }, { onConflict: "id" });
if (pErr) {
  if (!reused) await admin.auth.admin.deleteUser(userId);
  throw pErr;
}
await admin.from("employee_hr").upsert(
  { profile_id: userId, joined_on: new Date().toISOString().slice(0, 10), left_on: null },
  { onConflict: "profile_id" },
);

console.log(`\n✔ Admin ${reused ? "restored (existing login reused)" : "created"}\n  sign in with: ${realEmail ?? username}\n  password: ${password}\n\nSign in, then change the password under My account.\n`);
