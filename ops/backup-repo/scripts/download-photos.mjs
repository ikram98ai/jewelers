// Downloads every object in the private item-photos bucket to ./<outDir>.
// Runs in the PRIVATE backup repo only (needs the service-role key).
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const outDir = process.argv[2] ?? "photos";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const bucket = sb.storage.from("item-photos");

async function list(prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await list(path))); // folder
      else out.push(path);
    }
    if (data.length < 1000) return out;
  }
}

const paths = await list();
let n = 0;
for (const p of paths) {
  const { data, error } = await bucket.download(p);
  if (error) throw new Error(`${p}: ${error.message}`);
  const file = join(outDir, p);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await data.arrayBuffer()));
  n++;
}
console.log(`Downloaded ${n} photos`);
