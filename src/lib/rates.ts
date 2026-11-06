import { purityRatio } from "./format";

/** The market quotes gold and silver per troy ounce, not the 28.35 g everyday ounce. */
export const GRAMS_PER_TROY_OUNCE = 31.1034768;

export const rateKey = (metal: string, purity: string) => `${metal}:${purity}`;

export interface MetalSpot {
  currency: string;
  gold_usd_per_oz: number;
  silver_usd_per_oz: number;
  usd_rate: number;
  prices_updated_at: string;
}

/** Per-gram rates from the market price, as whole currency units like the rest of the rates form.
 *  Platinum is not in the feed, so it stays as the admin entered it. */
export function liveRates(spot: MetalSpot, rows: { metal: string; purity: string }[]): Record<string, number> {
  const pure: Record<string, number> = {
    gold: (spot.gold_usd_per_oz / GRAMS_PER_TROY_OUNCE) * spot.usd_rate,
    silver: (spot.silver_usd_per_oz / GRAMS_PER_TROY_OUNCE) * spot.usd_rate,
  };
  const out: Record<string, number> = {};
  for (const { metal, purity } of rows) {
    const ratio = purityRatio(metal, purity);
    if (pure[metal] !== undefined && ratio !== null) out[rateKey(metal, purity)] = Math.round(pure[metal] * ratio);
  }
  return out;
}

/** "YYYY-MM-DD" in a timezone, matching public.shop_today(). */
export function todayIn(timeZone: string | undefined, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface RatePoint {
  day: string;
  rate: number;
}

/** One point per calendar day from `from` to `to`. A saved rate stays in force until the next one,
 *  as in public.current_rate(), so days without an entry carry the last rate forward. Days before
 *  the first rate ever saved are left out rather than drawn as zero. */
export function dailySeries(
  rows: { effective_on: string; rate_per_g: number | string }[],
  from: string,
  to: string,
): RatePoint[] {
  const sorted = [...rows].sort((a, b) => a.effective_on.localeCompare(b.effective_on));
  const points: RatePoint[] = [];
  let next = 0;
  let rate: number | null = null;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (next < sorted.length && sorted[next].effective_on <= day) {
      rate = Number(sorted[next].rate_per_g);
      next += 1;
    }
    if (rate !== null) points.push({ day, rate });
  }
  return points;
}
