// Turn Postgres / PostgREST / Edge Function errors into plain-language messages.
// Our SQL functions raise "CODE: human message"; we show the human part.

const FRIENDLY: Record<string, string> = {
  NOT_AUTHORIZED: "Your account is not active. Ask an admin.",
  ADMIN_ONLY: "Only an admin can do this.",
  CREDIT_NEEDS_CLIENT: "Choose a client to leave a balance due. Walk-in sales must be paid in full.",
  ALREADY_VOID: "This sale is already void.",
  USERNAME_TAKEN: "That username is already taken.",
  LAST_ADMIN: "The shop must keep at least one active admin.",
  SELF_CHANGE: "You can't demote or deactivate yourself.",
  UNAUTHENTICATED: "Your session expired. Please sign in again.",
  FEED_UNAVAILABLE: "Live prices are not available right now. Try again, or enter the rates by hand.",
  CURRENCY_UNSUPPORTED: "Live prices are not available in the shop's currency. Enter the rates by hand.",
};

type ErrorLike = { message?: string; code?: string; details?: string; context?: unknown };

export function friendlyError(err: unknown): string {
  if (!err) return "Something went wrong.";
  if (typeof err === "string") return err;
  const e = err as ErrorLike;
  const msg = e.message ?? "";

  if (msg === "Invalid login credentials") return "Wrong username or password.";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "No connection. Check the internet and try again.";
  }
  if (e.code === "42501") {
    const m = msg.match(/^([A-Z_]+)(?::\s*(.*))?$/);
    if (m && FRIENDLY[m[1]]) return FRIENDLY[m[1]];
    return "You don't have permission to do this.";
  }
  if (e.code === "23505") {
    if (msg.includes("clients_phone_key")) return "A client with this phone number already exists.";
    if (msg.includes("username")) return "That username is already taken.";
    return "This already exists.";
  }
  if (e.code === "23514") return "Some values are not valid. Check the form.";

  const m = msg.match(/^([A-Z_]+)(?::\s*(.*))?$/);
  if (m) {
    const [, code, rest] = m;
    if (rest && code !== "ADMIN_ONLY") return rest.charAt(0).toUpperCase() + rest.slice(1);
    return FRIENDLY[code] ?? msg;
  }
  return msg || "Something went wrong.";
}

/** Edge Function errors arrive as a Response in `error.context`. */
export async function functionError(err: unknown): Promise<string> {
  const ctx = (err as ErrorLike)?.context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.json()) as { error?: string; message?: string };
      if (body.error && FRIENDLY[body.error]) return FRIENDLY[body.error];
      if (body.message) return body.message;
    } catch {
      /* fall through */
    }
  }
  return friendlyError(err);
}
