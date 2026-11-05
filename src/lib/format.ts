export const GRAMS_PER_TOLA = 11.664;

export type WeightUnit = "g" | "tola";

export interface MoneyFormat {
  currency_symbol: string;
  currency_code: string;
}

export function money(value: number | string | null | undefined, fmt?: MoneyFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  const body = Math.round(n).toLocaleString("en-US");
  return fmt ? `${fmt.currency_symbol} ${body}` : body;
}

export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/** "4.120 g" or "4.120 g · 0.353 tola" */
export function weight(grams: number | string | null | undefined, unit: WeightUnit = "g"): string {
  const g = num(grams);
  if (g === null) return "—";
  const gs = `${g.toFixed(3)} g`;
  return unit === "tola" ? `${gs} · ${(g / GRAMS_PER_TOLA).toFixed(3)} tola` : gs;
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function phoneDisplay(digits: string | null | undefined): string {
  if (!digits) return "—";
  if (digits.length === 11 && digits.startsWith("0")) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return digits;
}

/** Local numbers starting with 0 become international using the shop's country code. */
export function whatsappLink(digits: string, countryCode: string): string {
  return `https://wa.me/${digits.startsWith("0") ? countryCode + digits.slice(1) : digits}`;
}

/** Mirrors public.price_for() for live previews. The database is the source of truth. */
export function previewPrice(input: {
  rate: number | null;
  netWeight: number | null;
  makingType: "per_gram" | "fixed";
  makingCharge: number | null;
  stoneCharge: number | null;
  fixedPrice: number | null;
}): number | null {
  if (input.fixedPrice !== null) return Math.round(input.fixedPrice);
  if (input.rate === null || input.netWeight === null) return null;
  const making = input.makingType === "fixed"
    ? (input.makingCharge ?? 0)
    : (input.makingCharge ?? 0) * input.netWeight;
  return Math.round(input.netWeight * input.rate + making + (input.stoneCharge ?? 0));
}

/** value = weight × rate × (1 − deduction%) — mirrors public._record_payment(). */
export function oldGoldValue(weightG: number | null, rate: number | null, deductionPct: number | null): number | null {
  if (!weightG || !rate) return null;
  return Math.round(weightG * rate * (1 - (deductionPct ?? 0) / 100));
}

export const METALS = [
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
  { value: "platinum", label: "Platinum" },
  { value: "other", label: "Other / artificial" },
] as const;

export const PURITIES: Record<string, string[]> = {
  gold: ["24K", "22K", "21K", "18K", "14K"],
  silver: ["999", "925"],
  platinum: ["950", "900"],
  other: [],
};

/** Purity as a fraction of pure metal, for "fill from 24K" helpers. */
export function purityRatio(metal: string, purity: string): number | null {
  if (metal === "gold" && purity.endsWith("K")) return Number(purity.slice(0, -1)) / 24;
  if (/^\d{3}$/.test(purity)) return Number(purity) / 1000;
  return null;
}

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "old_gold", label: "Old gold" },
  { value: "exchange", label: "Exchange credit" },
  { value: "other", label: "Other" },
] as const;

export const SET_PART_KINDS = [
  { value: "necklace", label: "Necklace" }, { value: "earrings", label: "Earrings" }, { value: "ring", label: "Ring" },
  { value: "bangle", label: "Bangle(s)" }, { value: "bracelet", label: "Bracelet" }, { value: "tikka", label: "Tikka" },
  { value: "jhoomar", label: "Jhoomar" }, { value: "pendant", label: "Pendant" }, { value: "chain", label: "Chain" },
  { value: "nose_pin", label: "Nose pin" }, { value: "anklet", label: "Anklet" }, { value: "other", label: "Other" },
] as const;

export function partLabel(kind: string): string {
  return SET_PART_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export function methodLabel(m: string): string {
  return PAYMENT_METHODS.find((p) => p.value === m)?.label ?? m;
}
