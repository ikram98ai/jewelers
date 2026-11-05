import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError =
  !url || !anonKey ? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. See .env.example." : null;

// The anon (publishable) key is public by design. Row Level Security in Postgres
// decides what each signed-in user may read or write.
export const supabase = createClient<Database>(url ?? "http://localhost", anonKey ?? "missing", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "jewelers-auth",
  },
});

export const LOGIN_EMAIL_DOMAIN = (import.meta.env.VITE_LOGIN_EMAIL_DOMAIN as string | undefined) ?? "shop.local";

/** Staff log in with a username (mapped to <username>@<domain>); an admin
 *  created with a real email address can log in with that email instead. */
export function usernameToEmail(login: string): string {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${LOGIN_EMAIL_DOMAIN}`;
}

export const PHOTO_BUCKET = "item-photos";
