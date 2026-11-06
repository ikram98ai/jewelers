// Demo photos for items without one, in two reviewed steps:
//   collect  search Openverse (openly licensed only), drop results whose title/tags mention people
//            or body parts, download + resize candidates per design into <work>/pool/, write pool.json.
//            Nothing is uploaded.
//   upload   read <work>/approved.json ({ "<design>": [candidate numbers…] }) after a human has looked
//            at every candidate, upload the approved images through the app API as an admin, and write
//            docs/demo-image-credits.md (creator + license of every photo).
//
//   ADMIN_EMAIL=ismail ADMIN_PASSWORD=… node --env-file=.env scripts/demo-photos.mjs collect|upload <work-dir>
//
// <work-dir> must be a folder outside the repo: downloaded files are untrusted data.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;
const DOMAIN = process.env.VITE_LOGIN_EMAIL_DOMAIN ?? "shop.local";
const login = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const [mode, work] = process.argv.slice(2);
if (!URL_ || !KEY || !login || !password || !work || !["collect", "upload"].includes(mode)) {
  throw new Error("usage: ADMIN_EMAIL=… ADMIN_PASSWORD=… node --env-file=.env scripts/demo-photos.mjs collect|upload <work-dir>");
}
const UA = "jewelers-demo-seed/1.0 (+https://github.com/ikram98ai/jewelers)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(join(work, "dl"), { recursive: true });
mkdirSync(join(work, "pool"), { recursive: true });

// No people or body parts in demo photos: drop results whose title or tags mention them.
const PEOPLE = /\b(person|people|man|men|woman|women|girl|girls|boy|boys|child|children|kid|kids|baby|babies|bride|brides|bridal party|groom|wedding|marriage|model|models|portrait|selfie|face|faces|hand|hands|finger|fingers|wrist|wrists|arm|arms|leg|legs|foot|feet|toe|toes|ankle|neck|ear|ears|lip|lips|eye|eyes|hair|skin|body|lady|ladies|wearing|worn|dancer|dancing|dance|crowd|couple|mehndi|mehendi|henna|smile|smiling|festival|celebration|actress|actor|fashion show)\b/i;
const hasPeople = (r) => PEOPLE.test([r.title, ...(r.tags ?? []).map((t) => t.name)].join(" "));

// Search terms per item design (English, jewellery-specific). Fallback: the item's own name.
const QUERIES = {
  "Silver anklet pair (payal)": ["silver anklet", "payal anklet"],
  "Silver anklet with bells": ["anklet bells", "silver anklet"],
  "Kara, carved": ["gold kada bracelet", "gold bangle carved"],
  "Plain bangle (churi)": ["gold bangles", "bangles"],
  "Ladies bracelet": ["gold bracelet", "bracelet jewelry"],
  "Box chain 18 inch": ["gold chain necklace", "gold chain"],
  "Rope chain 20 inch": ["gold rope chain", "gold chain"],
  "Bali hoops": ["gold hoop earrings", "hoop earrings"],
  "Jhumka earrings": ["jhumka", "jhumka earrings", "indian earrings"],
  "Tops (studs)": ["gold stud earrings", "stud earrings"],
  "Aqeeq (agate), Yemeni 8 ct": ["agate gemstone", "carnelian"],
  "Blue sapphire (neelam) 2.3 ct": ["blue sapphire gemstone", "sapphire gem"],
  "Emerald (zamurd), Swat 1.8 ct": ["emerald gemstone", "emerald gem"],
  "Feroza (turquoise), Nishapuri 5 ct": ["turquoise stone", "turquoise gemstone"],
  "Feroza ring stone 3 ct": ["turquoise cabochon", "turquoise stone"],
  "Lapis lazuli, Afghan 12 ct": ["lapis lazuli"],
  "Peridot (zabarjad) 3.4 ct": ["peridot gemstone", "peridot"],
  "Ruby (yaqoot) 1.6 ct": ["ruby gemstone", "ruby gem"],
  "Ruby (yaqoot), Mozambique 2.1 ct": ["ruby gemstone", "ruby gem"],
  "Ruby, Burmese 1.05 ct": ["ruby gem", "ruby gemstone"],
  "Gold bar 20 g": ["gold bar", "gold bullion"],
  "Gold biscuit 1 tola": ["gold bullion bar", "gold bar"],
  "Gold biscuit 10 tola": ["gold bullion", "gold bars"],
  "Gold biscuit 5 tola": ["gold bar", "gold bullion bar"],
  "Gold coin 10 g": ["gold coin", "gold coins"],
  "Choker with ruby": ["ruby necklace", "gold choker necklace"],
  "Necklace, Balochi design": ["gold necklace traditional", "gold necklace"],
  "Necklace, kundan": ["kundan necklace", "kundan jewellery"],
  "Gold laung (nose pin) 22K": ["nose ring gold", "nose pin"],
  "Silver nose pin, design 3": ["nose stud", "nose pin"],
  "Ayat-ul-Kursi pendant": ["islamic calligraphy pendant", "gold pendant"],
  "Locket with emerald": ["emerald pendant", "gold locket"],
  "Engagement ring, zircon": ["engagement ring", "diamond ring"],
  "Gents ring with feroza": ["turquoise ring", "men turquoise ring"],
  "Gents ring, plain band": ["gold band ring", "gold wedding band"],
  "Ladies ring with ruby (yaqoot)": ["ruby ring", "gold ruby ring"],
  "Ladies ring, floral": ["gold ring", "gold flower ring"],
  "Silver ring with aqeeq": ["agate ring", "silver ring stone"],
  "Bridal set (necklace, earrings, tikka)": ["indian bridal jewellery", "bridal jewelry set", "kundan jewellery"],
  "Bridal set, pre-owned (Noor Jahan)": ["indian bridal jewellery", "bridal jewelry set"],
  "Silver bar 100 g": ["silver bar", "silver bullion"],
  "Silver bar 500 g": ["silver bullion", "silver bar"],
  "Silver bracelet, oxidised": ["silver bracelet", "oxidised silver bracelet"],
  "Silver glass pair (gilas)": ["silver cup", "silver goblet"],
};

async function retry(what, fn, tries = 7) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw new Error(`${what}: ${e.message}`);
      await sleep(Math.min(60000, 4000 * 2 ** (i - 1)));
    }
  }
}

let token;
async function signIn() {
  const email = login.includes("@") ? login : `${login}@${DOMAIN}`;
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("admin sign-in failed");
  token = j.access_token;
  setTimeout(signIn, 50 * 60_000).unref();   // tokens last 1 h
}
const H = () => ({ apikey: KEY, Authorization: `Bearer ${token}` });

async function search(q) {
  return retry(`search "${q}"`, async () => {
    const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&page_size=20&mature=false`, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    await sleep(1500);
    return (j.results ?? []).filter((x) => (x.width ?? 0) >= 300 && (x.height ?? 0) >= 300 && !hasPeople(x));
  });
}

async function fetchImage(result, file) {
  for (const u of [`https://api.openverse.org/v1/images/${result.id}/thumb/`, result.url]) {
    try {
      const r = await retry(`download ${result.id}`, async () => {
        const res = await fetch(u, { headers: { "User-Agent": UA } });
        if (res.status === 404) return res;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      }, 4);
      if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 5000) continue;
      writeFileSync(file, buf);
      return true;
    } catch { /* next source */ }
  }
  return false;
}

function toJpeg(src, dst) {
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "72", "--resampleHeightWidthMax", "1200", src, "--out", dst], { stdio: "ignore" });
  if (statSync(dst).size > 1_000_000) {
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "55", "--resampleHeightWidthMax", "900", src, "--out", dst], { stdio: "ignore" });
  }
}

async function upload(itemId, file) {
  const path = `${itemId}/${randomUUID()}.jpg`;
  const up = await fetch(`${URL_}/storage/v1/object/item-photos/${path}`, { method: "POST", headers: { ...H(), "Content-Type": "image/jpeg", "cache-control": "31536000" }, body: readFileSync(file) });
  if (!up.ok) throw new Error(`storage ${up.status} ${await up.text()}`);
  const ins = await fetch(`${URL_}/rest/v1/item_photos`, { method: "POST", headers: { ...H(), "Content-Type": "application/json" }, body: JSON.stringify({ item_id: itemId, storage_path: path, sort_order: 0 }) });
  if (!ins.ok) throw new Error(`item_photos ${ins.status} ${await ins.text()}`);
}

await signIn();
const items = await (await fetch(`${URL_}/rest/v1/items?select=id,tag,name,status,item_photos(id)&order=tag`, { headers: H() })).json();
const todo = items.filter((i) => i.item_photos.length === 0);
const groups = new Map();
for (const it of todo) groups.set(it.name, [...(groups.get(it.name) ?? []), it]);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const poolFile = join(work, "pool.json");

if (mode === "collect") {
  console.log(`${items.length} items, ${todo.length} without a photo, ${groups.size} designs`);
  const pool = {};
  const seen = new Set();
  for (const [name, group] of groups) {
    const want = group.length + 4;          // spares so rejected images can be replaced
    let results = [];
    for (const q of QUERIES[name] ?? [name]) {
      if (results.length >= want * 2) break;
      try {
        for (const r of await search(q)) if (!seen.has(r.id) && !results.some((p) => p.id === r.id)) results.push(r);
      } catch (e) { console.log(`  ! ${e.message}`); }
    }
    const dir = join(work, "pool", slug(name));
    mkdirSync(dir, { recursive: true });
    const images = [];
    for (const r of results) {
      if (images.length >= want) break;
      const n = String(images.length + 1).padStart(2, "0");
      const raw = join(work, "dl", r.id), out = join(dir, `${n}.jpg`);
      try {
        if (!(await fetchImage(r, raw))) continue;
        toJpeg(raw, out);
        seen.add(r.id);
        images.push({ n: Number(n), file: out, id: r.id, title: r.title, creator: r.creator,
                      license: `${(r.license ?? "").toUpperCase()} ${r.license_version ?? ""}`.trim(), url: r.foreign_landing_url });
      } catch { /* skip */ }
    }
    pool[name] = { slug: slug(name), items: group.map((g) => ({ id: g.id, tag: g.tag })), images };
    writeFileSync(poolFile, JSON.stringify(pool, null, 2));
    console.log(`${name}: ${group.length} item(s), ${images.length} candidate(s) in pool/${slug(name)}/`);
  }
  console.log(`\nCOLLECTED. Review ${join(work, "pool")} and write ${join(work, "approved.json")}`);
} else {
  const pool = JSON.parse(readFileSync(poolFile, "utf8"));
  const approved = JSON.parse(readFileSync(join(work, "approved.json"), "utf8"));
  const credits = [];
  let done = 0, skipped = 0;
  for (const [name, picks] of Object.entries(approved)) {
    const p = pool[name];
    if (!p || !picks.length) { skipped += p?.items.length ?? 0; continue; }
    const imgs = picks.map((n) => p.images.find((x) => x.n === n)).filter(Boolean);
    for (const [i, it] of p.items.entries()) {
      if (!todo.some((t) => t.id === it.id)) continue;        // got a photo meanwhile
      const img = imgs[i % imgs.length];                     // distinct while they last, then repeat
      try {
        await upload(it.id, img.file);
        credits.push({ tag: it.tag, name, ...img });
        done++;
      } catch (e) { console.log(`  ! ${it.tag}: ${e.message.slice(0, 120)}`); }
    }
    console.log(`${name}: ${p.items.length} item(s) ← ${imgs.length} approved image(s)`);
  }
  const md = ["# Demo item photos: credits", "",
    "Openly licensed images from [Openverse](https://openverse.org) (commercial use allowed), resized for the app.",
    "Each was reviewed by eye: no people or body parts. They are placeholders for the demo shop; replace them with real photos of the stock.", "",
    "| Item | Design | Image | Creator | License |", "|---|---|---|---|---|",
    ...credits.sort((a, b) => a.tag.localeCompare(b.tag)).map((c) =>
      `| ${c.tag} | ${c.name} | [${(c.title ?? "image").replace(/\|/g, "/").slice(0, 60)}](${c.url}) | ${(c.creator ?? "unknown").replace(/\|/g, "/").slice(0, 40)} | ${c.license} |`)];
  writeFileSync("docs/demo-image-credits.md", md.join("\n") + "\n");
  console.log(`\nDONE: ${done} uploaded, ${skipped} left without a photo. Credits: docs/demo-image-credits.md`);
}
