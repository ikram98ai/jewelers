import { LineChart } from "@mantine/charts";
import { Box, Card, Group, Select, SegmentedControl, Text, Title } from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ErrorText, Money } from "@/components/ui";
import { money, shortDate } from "@/lib/format";
import { unwrap, useSettings } from "@/lib/queries";
import { addDays, dailySeries, rateKey, todayIn } from "@/lib/rates";
import { supabase } from "@/lib/supabase";

// Fixed per metal, so a metal keeps its color whatever is selected.
const METAL_COLOR: Record<string, string> = { gold: "#ab7c00", silver: "#2f7fc1", platinum: "#b4506e" };
const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "365", label: "1 year" },
];
// At most one row per day, so this always covers the longest range plus the rate in force before it.
const MAX_ROWS = 400;

const metalName = (metal: string) => metal[0].toUpperCase() + metal.slice(1);

export function RateTrendCard({ options, factor, unitLabel }: {
  options: { metal: string; purity: string }[];
  factor: number;
  unitLabel: string;
}) {
  const { fmt, settings } = useSettings();
  const [selected, setSelected] = useState(rateKey("gold", "22K"));
  const [range, setRange] = useState("30");
  const [metal, purity] = selected.split(":");

  // Under the "rates-history" key, so saving rates refreshes this too.
  const trend = useQuery({
    queryKey: ["rates-history", metal, purity],
    queryFn: async () => unwrap(await supabase.from("metal_rates").select("effective_on, rate_per_g")
      .eq("metal", metal).eq("purity", purity)
      .order("effective_on", { ascending: false }).limit(MAX_ROWS)) as { effective_on: string; rate_per_g: number }[],
    placeholderData: keepPreviousData,
  });

  const data = useMemo(() => {
    const today = todayIn(settings?.timezone);
    return dailySeries(trend.data ?? [], addDays(today, 1 - Number(range)), today).map((p) => ({
      label: shortDate(p.day), rate: p.rate * factor,
    }));
  }, [trend.data, settings?.timezone, range, factor]);

  const first = data[0];
  const last = data[data.length - 1];
  const change = first && last ? last.rate - first.rate : 0;
  const percent = first && first.rate > 0 ? (change / first.rate) * 100 : 0;
  const name = `${metalName(metal)} ${purity}`;

  return (
    <Card mb="lg">
      <Group justify="space-between" mb="md" gap="sm">
        <Title order={4}>Your rate trend</Title>
        <Group gap="sm">
          <Select
            aria-label="Metal and purity" size="sm" w={150} value={selected}
            onChange={(v) => v && setSelected(v)}
            data={options.map((o) => ({ value: rateKey(o.metal, o.purity), label: `${metalName(o.metal)} ${o.purity}` }))}
          />
          <SegmentedControl size="sm" aria-label="Date range" value={range} onChange={setRange} data={RANGES} />
        </Group>
      </Group>
      <ErrorText error={trend.error} />
      {!trend.isLoading && !last ? (
        <Text c="dimmed" size="sm">No saved {name} rates in this period.</Text>
      ) : (
        <Box style={{ opacity: trend.isPlaceholderData ? 0.5 : 1 }}>
          <Group gap="xs" align="baseline" mb="sm" wrap="wrap">
            <Money value={last?.rate} size="xl" fw={700} />
            <Text size="sm" c="dimmed">{name} per {unitLabel}</Text>
            {first && last && (
              <Text size="sm" c="dimmed">
                {change === 0 ? "No change" : `${change > 0 ? "↑ +" : "↓ −"}${money(Math.abs(change), fmt)} (${Math.abs(percent).toFixed(1)}%)`} since {first.label}
              </Text>
            )}
          </Group>
          <LineChart
            h={260}
            data={data}
            dataKey="label"
            series={[{ name: "rate", label: name, color: METAL_COLOR[metal] }]}
            // A rate holds until the next one is saved, so it moves in steps rather than sloping between days.
            curveType="stepAfter"
            strokeWidth={2}
            withDots={data.length < 2}
            gridAxis="x"
            strokeDasharray="0"
            tooltipAnimationDuration={0}
            valueFormatter={(v) => money(v, fmt)}
            // Full numbers on the axis: compact ones repeat ("36.6K") when a rate moves only slightly.
            yAxisProps={{ domain: ["auto", "auto"], width: 64, tickFormatter: (v: number) => money(v) }}
            xAxisProps={{ minTickGap: 48, tickFormatter: (v: string) => v.split(" ").slice(0, 2).join(" ") }}
          />
        </Box>
      )}
    </Card>
  );
}
