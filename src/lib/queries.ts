import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { MoneyFormat, WeightUnit } from "./format";
import type { Category, Dashboard, ShopSettings, TodayRate } from "./types";

/** Throw Supabase errors so React Query surfaces them. */
export function unwrap<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export const qk = {
  settings: ["settings"] as const,
  categories: ["categories"] as const,
  rates: ["rates"] as const,
  dashboard: ["dashboard"] as const,
  items: (params: unknown) => ["items", params] as const,
  item: (id: string) => ["item", id] as const,
  clients: (q: string) => ["clients", q] as const,
  client: (id: string) => ["client", id] as const,
  sales: (params: unknown) => ["sales", params] as const,
  sale: (id: string) => ["sale", id] as const,
  employees: ["employees"] as const,
  employee: (id: string) => ["employee", id] as const,
};

export function useSettings() {
  const query = useQuery({
    queryKey: qk.settings,
    queryFn: async () => unwrap(await supabase.from("shop_settings").select("*").eq("id", 1).single()) as ShopSettings,
    staleTime: 5 * 60_000,
  });
  const s = query.data;
  const fmt: MoneyFormat = { currency_symbol: s?.currency_symbol ?? "", currency_code: s?.currency_code ?? "" };
  const unit: WeightUnit = (s?.weight_unit as WeightUnit) ?? "g";
  return { ...query, settings: s, fmt, unit };
}

export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    queryFn: async () => unwrap(await supabase.from("categories").select("*").order("name")) as Category[],
    staleTime: 5 * 60_000,
  });
}

export function useRates() {
  const query = useQuery({
    queryKey: qk.rates,
    queryFn: async () => unwrap(await supabase.rpc("rates_today")) as TodayRate[],
    staleTime: 60_000,
  });
  const rateFor = (metal: string, purity: string | null): number | null =>
    query.data?.find((r) => r.metal === metal && r.purity === purity)?.rate_per_g ?? null;
  const setToday = !!query.data?.some((r) => r.is_today);
  return { ...query, rateFor, setToday };
}

export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: async () => unwrap(await supabase.rpc("dashboard_summary")) as unknown as Dashboard,
    refetchInterval: 60_000,
  });
}
