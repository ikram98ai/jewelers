import { useQuery } from "@tanstack/react-query";
import { compressImage } from "./image";
import { PHOTO_BUCKET, supabase } from "./supabase";

export const CUSTODY_BUCKET = "custody-photos";

/** Upload one compressed photo to `bucket` under `folder/` and return its path. */
export async function uploadPhoto(bucket: string, folder: string, file: File): Promise<string> {
  const blob = await compressImage(file);
  const path = `${folder}/${crypto.randomUUID()}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (error) throw error;
  return path;
}

export async function uploadItemPhoto(itemId: string, file: File, sortOrder = 0): Promise<void> {
  const blob = await compressImage(file);
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${itemId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: blob.type, upsert: false, cacheControl: "31536000",
  });
  if (upErr) throw upErr;
  const { error } = await supabase.from("item_photos").insert({ item_id: itemId, storage_path: path, sort_order: sortOrder });
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
}

/** Batch-sign private photo paths (1 h). Returns path → URL. */
export function useSignedUrls(paths: string[], bucket: string = PHOTO_BUCKET) {
  const key = [...paths].sort().join("|");
  return useQuery({
    queryKey: ["signed-urls", bucket, key],
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
      return map;
    },
  });
}
