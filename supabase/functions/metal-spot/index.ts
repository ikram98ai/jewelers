// =============================================================================
// metal-spot: live gold and silver prices for the "Fill live prices" button.
//
//   POST /functions/v1/metal-spot
//
// Returns the international spot price (USD per troy ounce) and the USD rate for
// the shop's currency. It only reads: nothing here touches metal_rates, so shop
// prices change only when an admin reviews the form and presses Save.
//
// The caller's own JWT reads shop_settings. Row Level Security allows that only
// for active users, which also stops the public anon key using this as a proxy.
// =============================================================================
// Pinned exactly (supply chain): bump deliberately, together with package.json.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "http://localhost:5174,http://127.0.0.1:5174")
  .split(",").map((s) => s.trim()).filter(Boolean);

const FEED_TIMEOUT_MS = 8_000;

class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function feed(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("metal-spot feed failed", url, String(err));
    throw new HttpError(502, "FEED_UNAVAILABLE");
  }
}

/** A price we would put in front of an admin: a finite number above zero. */
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(502, "FEED_UNAVAILABLE");
  }
  return value;
}

async function shopCurrency(authorization: string): Promise<string> {
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.from("shop_settings").select("currency_code").eq("id", 1).maybeSingle();
  // 42501 = no permission (not a signed-in user). Anything else is a fault on our side, not the caller's.
  if (error && error.code !== "42501") {
    console.error("metal-spot settings read failed", error.message);
    throw new HttpError(500, "INTERNAL");
  }
  if (error || !data) throw new HttpError(401, "NOT_AUTHORIZED");
  return data.currency_code;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) throw new HttpError(401, "UNAUTHENTICATED");
    const currency = await shopCurrency(authorization);

    const [gold, silver, fx] = await Promise.all([
      feed("https://api.gold-api.com/price/XAU"),
      feed("https://api.gold-api.com/price/XAG"),
      feed("https://open.er-api.com/v6/latest/USD"),
    ]);
    const usdRate = (fx.rates as Record<string, unknown> | undefined)?.[currency];
    if (usdRate === undefined) throw new HttpError(422, "CURRENCY_UNSUPPORTED");

    return json({
      currency,
      gold_usd_per_oz: positive(gold.price),
      silver_usd_per_oz: positive(silver.price),
      usd_rate: positive(usdRate),
      prices_updated_at: gold.updatedAt,
    }, 200, origin);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status, origin);
    console.error("metal-spot failed", String(err));
    return json({ error: "INTERNAL" }, 500, origin);
  }
});
