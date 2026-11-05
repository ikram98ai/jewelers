import type { Database } from "./database.types";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export type Profile = Tables["profiles"]["Row"];
export type EmployeeHr = Tables["employee_hr"]["Row"];
export type SalaryPayment = Tables["salary_payments"]["Row"];
export type ShopSettings = Tables["shop_settings"]["Row"];
export type Category = Tables["categories"]["Row"];
export type MetalRate = Tables["metal_rates"]["Row"];
export type Item = Tables["items"]["Row"];
export type ItemWithPrice = Item & { suggested_price: number | null };
export type ItemCost = Tables["item_costs"]["Row"];
export type ItemPhoto = Tables["item_photos"]["Row"];
export type StockMove = Tables["stock_moves"]["Row"];
export type Client = Tables["clients"]["Row"];
export type Sale = Tables["sales"]["Row"];
export type SaleItem = Tables["sale_items"]["Row"];
export type Payment = Tables["payments"]["Row"];
export type OldGoldReceipt = Tables["old_gold_receipts"]["Row"];
export type AuditEntry = Tables["audit_log"]["Row"];
export type ItemComponent = Tables["item_components"]["Row"];
export type CustodyReceipt = Tables["custody_receipts"]["Row"];
export type CustodyItem = Tables["custody_items"]["Row"];
export type Purchase = Tables["purchases"]["Row"];
export type PurchaseItem = Tables["purchase_items"]["Row"];
export type SaleReturn = Tables["sale_returns"]["Row"];
export type SaleReturnItem = Tables["sale_return_items"]["Row"];
export type SaleBalance = Views["sale_balances"]["Row"];
export type ClientBalance = Views["client_balances"]["Row"];

export interface TodayRate {
  metal: string;
  purity: string;
  rate_per_g: number;
  effective_on: string;
  is_today: boolean;
}

export interface Dashboard {
  today: string;
  rates: TodayRate[];
  rates_set_today: boolean;
  sales_today: { count: number; total: number };
  payments_today: Record<string, number>;
  pieces_by_category: { category: string; pieces: number; net_weight_g: number | null }[];
  low_stock: { id: string; tag: string; name: string; qty_on_hand: number; low_stock_at: number }[];
  balances_due: { id: string; full_name: string; phone: string; balance: number }[];
  upcoming_dates: { id: string; full_name: string; phone: string; kind: "birthday" | "anniversary"; date: string }[];
  admin: null | {
    stock_value_cost: number;
    stock_value_today: number;
    gross_profit_today: number;
    gross_profit_month: number;
    sales_month: { count: number; total: number };
    discounts_by_staff: { full_name: string; sales: number; discount: number }[];
    missing_cost_count: number;
    old_gold_month: { purity: string; weight_g: number; value: number }[];
  };
}
