import { describe, expect, it } from "vitest";
import { addDays, dailySeries, liveRates, todayIn, type MetalSpot } from "./rates";

const rows = [
  { metal: "gold", purity: "24K" }, { metal: "gold", purity: "22K" }, { metal: "gold", purity: "18K" },
  { metal: "silver", purity: "999" }, { metal: "silver", purity: "925" }, { metal: "platinum", purity: "950" },
];
const spot: MetalSpot = {
  currency: "PKR", gold_usd_per_oz: 4000, silver_usd_per_oz: 50, usd_rate: 280, prices_updated_at: "2026-11-06T10:00:00Z",
};

describe("liveRates", () => {
  it("converts USD per troy ounce into the shop's currency per gram", () => {
    // 4000 / 31.1034768 × 280 = 36,009
    expect(liveRates(spot, rows)["gold:24K"]).toBe(36009);
  });
  it("scales each purity from the pure price", () => {
    const r = liveRates(spot, rows);
    expect(r["gold:22K"]).toBe(33008);
    expect(r["gold:18K"]).toBe(27007);
    expect(r["silver:925"]).toBe(416);
  });
  it("leaves metals outside the feed for the admin", () => {
    expect(liveRates(spot, rows)).not.toHaveProperty("platinum:950");
  });
});

describe("dailySeries", () => {
  const saved = [
    { effective_on: "2026-11-05", rate_per_g: "200" },
    { effective_on: "2026-11-02", rate_per_g: "100.5" },
  ];
  it("carries a rate forward until the next one", () => {
    expect(dailySeries(saved, "2026-11-02", "2026-11-06").map((p) => p.rate)).toEqual([100.5, 100.5, 100.5, 200, 200]);
  });
  it("uses a rate saved before the range for the first days", () => {
    expect(dailySeries(saved, "2026-11-04", "2026-11-04")).toEqual([{ day: "2026-11-04", rate: 100.5 }]);
  });
  it("skips days before the first saved rate", () => {
    expect(dailySeries(saved, "2026-10-31", "2026-11-02").map((p) => p.day)).toEqual(["2026-11-02"]);
  });
  it("is empty without rates", () => {
    expect(dailySeries([], "2026-11-01", "2026-11-06")).toEqual([]);
  });
});

describe("dates", () => {
  it("adds days across a month end", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("uses the shop's timezone for today", () => {
    const lateUtc = new Date("2026-11-06T22:00:00Z");
    expect(todayIn("Asia/Karachi", lateUtc)).toBe("2026-11-07");
    expect(todayIn("UTC", lateUtc)).toBe("2026-11-06");
  });
});
