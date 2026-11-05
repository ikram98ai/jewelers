import { functionError } from "./errors";
import { supabase } from "./supabase";

/** Calls the admin-users Edge Function (service role lives only there). */
async function call<T>(action: "create" | "reset-password" | "update", body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`admin-users/${action}`, { body });
  if (error) throw new Error(await functionError(error));
  return data as T;
}

export const adminUsers = {
  create: (body: {
    username: string; full_name: string; role: "admin" | "staff"; password: string; phone?: string;
    hr?: { joined_on?: string; monthly_salary?: number | null };
  }) => call<{ user_id: string; username: string }>("create", body),
  resetPassword: (user_id: string, password: string) => call<null>("reset-password", { user_id, password }),
  update: (body: { user_id: string; role?: "admin" | "staff"; active?: boolean; left_on?: string }) =>
    call<{ user_id: string; role: string; active: boolean }>("update", body),
};

/** Readable temporary password, e.g. "gold-4827-ring". */
export function suggestPassword(): string {
  const words = ["gold", "ring", "pearl", "ruby", "jade", "opal", "star", "moon", "rose", "silk"];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const n = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
  return `${pick()}-${n}-${pick()}`;
}
