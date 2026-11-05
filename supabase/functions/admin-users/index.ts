// =============================================================================
// admin-users: the only place the service-role key is used.
//
//   POST /functions/v1/admin-users/create          create employee + login
//   POST /functions/v1/admin-users/reset-password  set a new password
//   POST /functions/v1/admin-users/update          change role / (de)activate
//
// Every request must carry the caller's Supabase JWT, and the caller must be an
// ACTIVE ADMIN in public.profiles. Guards: no self-demotion/deactivation, and
// the last active admin can never be removed.
// =============================================================================
// Pinned exactly (supply chain): bump deliberately, together with package.json.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EMAIL_DOMAIN = Deno.env.get("LOGIN_EMAIL_DOMAIN") ?? "shop.local";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);

const BAN_FOREVER = "876000h"; // ~100 years
const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), ...(body === null ? {} : { "Content-Type": "application/json" }) },
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
type Body = Record<string, unknown>;

function str(b: Body, key: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const v = b[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new HttpError(422, "VALIDATION", `${key} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new HttpError(422, "VALIDATION", `${key} must be text`);
  const t = v.trim();
  if (opts.max && t.length > opts.max) throw new HttpError(422, "VALIDATION", `${key} is too long`);
  return t;
}

function password(b: Body): string {
  const p = b.password;
  if (typeof p !== "string" || p.length < 8 || p.length > 72) {
    throw new HttpError(422, "VALIDATION", "Password must be 8–72 characters");
  }
  return p;
}

function uuid(b: Body, key: string): string {
  const v = b[key];
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(422, "VALIDATION", `${key} must be a uuid`);
  return v;
}

function role(v: unknown): "admin" | "staff" {
  if (v !== "admin" && v !== "staff") throw new HttpError(422, "VALIDATION", "role must be admin or staff");
  return v;
}

function optDate(v: unknown, key: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v)) throw new HttpError(422, "VALIDATION", `${key} must be YYYY-MM-DD`);
  return v;
}

function optMoney(v: unknown, key: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(422, "VALIDATION", `${key} must be a positive number`);
  return n;
}

// ---------------------------------------------------------------------------
// Auth: caller must be an active admin
// ---------------------------------------------------------------------------
async function requireAdmin(req: Request): Promise<string> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHENTICATED");
  const { data, error } = await admin.auth.getUser(header.slice(7));
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED");

  const { data: profile, error: pErr } = await admin
    .from("profiles").select("role, active").eq("id", data.user.id).maybeSingle();
  if (pErr) throw new HttpError(500, "INTERNAL", pErr.message);
  if (!profile || !profile.active || profile.role !== "admin") throw new HttpError(403, "ADMIN_ONLY");
  return data.user.id;
}

async function audit(actor: string, targetId: string, action: "insert" | "update", data: Record<string, unknown>) {
  // Service-role writes have no auth.uid(), so record who did it explicitly.
  await admin.from("audit_log").insert({
    table_name: "admin_users", row_id: targetId, action, new_data: data, actor,
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function createEmployee(actor: string, b: Body) {
  const username = str(b, "username", { required: true })!.toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(422, "VALIDATION", "Username: 3–30 lowercase letters, digits, dot or underscore");
  }
  const fullName = str(b, "full_name", { required: true, max: 120 })!;
  const r = role(b.role);
  const pw = password(b);
  const phone = str(b, "phone", { max: 30 }) ?? null;
  const hr = (typeof b.hr === "object" && b.hr !== null ? b.hr : {}) as Body;

  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) throw new HttpError(409, "USERNAME_TAKEN", "That username is already taken");

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password: pw,
    email_confirm: true,
    user_metadata: { username },
  });
  if (error || !created.user) {
    if (error && /already|exists|registered/i.test(error.message)) {
      throw new HttpError(409, "USERNAME_TAKEN", "That username is already taken");
    }
    throw new HttpError(500, "INTERNAL", error?.message ?? "Could not create user");
  }
  const userId = created.user.id;

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId, username, full_name: fullName, role: r, phone,
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(userId); // roll back: no references exist yet
    throw new HttpError(500, "INTERNAL", profileErr.message);
  }

  const { error: hrErr } = await admin.from("employee_hr").insert({
    profile_id: userId,
    joined_on: optDate(hr.joined_on, "joined_on"),
    monthly_salary: optMoney(hr.monthly_salary, "monthly_salary"),
    national_id: str(hr, "national_id", { max: 40 }) ?? null,
    address: str(hr, "address", { max: 500 }) ?? null,
    emergency_contact: str(hr, "emergency_contact", { max: 200 }) ?? null,
    notes: str(hr, "notes", { max: 2000 }) ?? null,
  });
  if (hrErr) throw new HttpError(500, "INTERNAL", hrErr.message);

  await audit(actor, userId, "insert", { op: "create", username, role: r });
  return { status: 201, body: { user_id: userId, username } };
}

async function resetPassword(actor: string, b: Body) {
  const userId = uuid(b, "user_id");
  const pw = password(b);
  const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!profile) throw new HttpError(404, "NOT_FOUND");
  const { error } = await admin.auth.admin.updateUserById(userId, { password: pw });
  if (error) throw new HttpError(500, "INTERNAL", error.message);
  await audit(actor, userId, "update", { op: "reset_password" });
  return { status: 204, body: null };
}

async function updateEmployee(actor: string, b: Body) {
  const userId = uuid(b, "user_id");
  const newRole = b.role === undefined ? undefined : role(b.role);
  const newActive = b.active === undefined ? undefined : b.active === true;
  if (b.active !== undefined && typeof b.active !== "boolean") {
    throw new HttpError(422, "VALIDATION", "active must be true or false");
  }
  const leftOn = optDate(b.left_on, "left_on");

  const { data: target } = await admin.from("profiles").select("id, role, active").eq("id", userId).maybeSingle();
  if (!target) throw new HttpError(404, "NOT_FOUND");

  const losesAdmin = target.role === "admin" && target.active &&
    (newRole === "staff" || newActive === false);

  if (userId === actor && losesAdmin) {
    throw new HttpError(409, "SELF_CHANGE", "You cannot demote or deactivate yourself");
  }
  if (losesAdmin) {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
      .eq("role", "admin").eq("active", true).neq("id", userId);
    if (!count) throw new HttpError(409, "LAST_ADMIN", "The shop must keep at least one active admin");
  }

  if (newActive !== undefined && newActive !== target.active) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: newActive ? "none" : BAN_FOREVER,
    });
    if (error) throw new HttpError(500, "INTERNAL", error.message);
    const today = new Date().toISOString().slice(0, 10);
    await admin.from("employee_hr").upsert(
      { profile_id: userId, left_on: newActive ? null : (leftOn ?? today) },
      { onConflict: "profile_id" },
    );
  }

  const patch: Record<string, unknown> = {};
  if (newRole !== undefined) patch.role = newRole;
  if (newActive !== undefined) patch.active = newActive;
  if (Object.keys(patch).length) {
    const { error } = await admin.from("profiles").update(patch).eq("id", userId);
    if (error) throw new HttpError(500, "INTERNAL", error.message);
  }

  await audit(actor, userId, "update", { op: "update", ...patch });
  const { data: updated } = await admin.from("profiles").select("id, role, active").eq("id", userId).single();
  return { status: 200, body: { user_id: updated!.id, role: updated!.role, active: updated!.active } };
}

const routes: Record<string, (actor: string, body: Body) => Promise<{ status: number; body: unknown }>> = {
  create: createEmployee,
  "reset-password": resetPassword,
  update: updateEmployee,
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });

  try {
    if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED");
    const action = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
    const handler = routes[action];
    if (!handler) throw new HttpError(404, "UNKNOWN_ACTION");

    const actor = await requireAdmin(req);
    let body: Body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "BAD_JSON");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "BAD_JSON");

    const result = await handler(actor, body);
    return json(result.body, result.status, origin);
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.code, message: e.message }, e.status, origin);
    }
    console.error(e);
    return json({ error: "INTERNAL", message: "Unexpected error" }, 500, origin);
  }
});
