import { describe, expect, it } from "vitest";
import { money, oldGoldValue, previewPrice, purityRatio, weight } from "./format";

describe("previewPrice (mirrors public.price_for)", () => {
  it("per-gram making", () => {
    expect(previewPrice({ rate: 20000, netWeight: 5, makingType: "per_gram", makingCharge: 1000, stoneCharge: 2000, fixedPrice: null }))
      .toBe(107000);
  });
  it("fixed making", () => {
    expect(previewPrice({ rate: 20000, netWeight: 5, makingType: "fixed", makingCharge: 12000, stoneCharge: 0, fixedPrice: null }))
      .toBe(112000);
  });
  it("fixed price wins", () => {
    expect(previewPrice({ rate: 20000, netWeight: 5, makingType: "per_gram", makingCharge: 1000, stoneCharge: 0, fixedPrice: 6500 }))
      .toBe(6500);
  });
  it("no rate → null", () => {
    expect(previewPrice({ rate: null, netWeight: 5, makingType: "per_gram", makingCharge: 0, stoneCharge: 0, fixedPrice: null }))
      .toBeNull();
  });
});

describe("old gold", () => {
  it("applies the deduction", () => {
    expect(oldGoldValue(3, 18000, 2)).toBe(52920);
  });
});

describe("formatting", () => {
  it("money", () => {
    expect(money(1234567.4, { currency_symbol: "Rs", currency_code: "PKR" })).toBe("Rs 1,234,567");
    expect(money(null)).toBe("—");
  });
  it("weight in tola", () => {
    expect(weight(11.664, "tola")).toBe("11.664 g · 1.000 tola");
  });
  it("purity ratio", () => {
    expect(purityRatio("gold", "22K")).toBeCloseTo(0.9167, 3);
    expect(purityRatio("silver", "925")).toBe(0.925);
  });
});

import { parseCsv } from "./csv";
describe("parseCsv", () => {
  it("handles quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
  });
});
