// Fails if the built app contains a real Supabase secret: an sb_secret_… key value,
// or a JWT whose payload says role=service_role. (Library code that merely
// mentions the "sb_secret_" prefix is fine.)   Usage: node scripts/check-bundle-secrets.mjs dist
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "dist";
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  statSync(p).isDirectory() ? walk(p) : /\.(js|html|css|json|map|txt|webmanifest)$/.test(f) && files.push(p);
});
walk(root);

const problems = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/sb_secret_[A-Za-z0-9_-]{16,}/g)) problems.push(`${f}: secret key ${m[0].slice(0, 14)}…`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (payload.role === "service_role" || payload.role === "supabase_admin") problems.push(`${f}: ${payload.role} JWT`);
    } catch { /* not a JWT */ }
  }
}
if (problems.length) {
  console.error("✘ Secret material found in the build:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`✔ No secrets in ${files.length} built files`);
