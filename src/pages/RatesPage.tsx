import { Alert, Button, Card, Group, NumberInput, SimpleGrid, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconWand } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ErrorText, Loading, Money, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { GRAMS_PER_TOLA, money, num, purityRatio, shortDate } from "@/lib/format";
import { unwrap, useRates, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { MetalRate } from "@/lib/types";

const ROWS: { metal: string; purity: string }[] = [
  { metal: "gold", purity: "24K" }, { metal: "gold", purity: "22K" }, { metal: "gold", purity: "21K" },
  { metal: "gold", purity: "18K" }, { metal: "gold", purity: "14K" },
  { metal: "silver", purity: "999" }, { metal: "silver", purity: "925" },
  { metal: "platinum", purity: "950" },
];
const key = (m: string, p: string) => `${m}:${p}`;

export default function RatesPage() {
  const { isAdmin } = useAuth();
  const { fmt, unit } = useSettings();
  const rates = useRates();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, number | string>>({});
  const [perTola, setPerTola] = useState(unit === "tola");

  useEffect(() => {
    if (!rates.data) return;
    const v: Record<string, number> = {};
    for (const r of rates.data) v[key(r.metal, r.purity)] = Number(r.rate_per_g);
    setValues(v);
  }, [rates.data]);

  const history = useQuery({
    queryKey: ["rates-history"],
    queryFn: async () => unwrap(await supabase.from("metal_rates").select("*")
      .order("effective_on", { ascending: false }).order("metal").order("purity").limit(120)) as MetalRate[],
  });

  const byDay = useMemo(() => {
    const m = new Map<string, MetalRate[]>();
    for (const r of history.data ?? []) m.set(r.effective_on, [...(m.get(r.effective_on) ?? []), r]);
    return [...m.entries()].slice(0, 14);
  }, [history.data]);

  const factor = perTola ? GRAMS_PER_TOLA : 1;
  const shown = (k: string) => (values[k] === "" || values[k] === undefined ? "" : Math.round(Number(values[k]) * factor));
  const setShown = (k: string, val: number | string) =>
    setValues((s) => ({ ...s, [k]: val === "" ? "" : Number(val) / factor }));

  const fillFrom24 = () => {
    const base = num(values[key("gold", "24K")]);
    if (!base) return notifications.show({ color: "orange", message: "Enter the 24K rate first" });
    const next = { ...values };
    for (const r of ROWS.filter((x) => x.metal === "gold" && x.purity !== "24K")) {
      next[key(r.metal, r.purity)] = Math.round(base * purityRatio(r.metal, r.purity)!);
    }
    setValues(next);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = ROWS
        .map((r) => ({ metal: r.metal, purity: r.purity, rate_per_g: num(values[key(r.metal, r.purity)]) }))
        .filter((r) => r.rate_per_g && r.rate_per_g > 0)
        .map((r) => ({ ...r, rate_per_g: Math.round(r.rate_per_g! * 100) / 100 }));
      if (payload.length === 0) throw new Error("Enter at least one rate");
      return unwrap(await supabase.rpc("set_metal_rates", { p_rates: payload }));
    },
    onSuccess: () => {
      notifications.show({ color: "green", message: "Today's rates saved. All prices are updated." });
      queryClient.invalidateQueries({ queryKey: ["rates"] });
      queryClient.invalidateQueries({ queryKey: ["rates-history"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["item"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (rates.isLoading) return <Loading />;

  return (
    <>
      <PageHeader
        title="Metal rates"
        subtitle={isAdmin ? "Set today's buying rate per gram. Every price in the shop updates instantly." : "Rates set by the admin. Prices use the latest rate."}
        actions={<Switch label="Show per tola" checked={perTola} onChange={(e) => setPerTola(e.currentTarget.checked)} />}
      />
      <ErrorText error={rates.error} />

      <Card mb="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{isAdmin ? "Today's rates" : "Current rates"}</Title>
          {isAdmin && <Button variant="light" color="gold" leftSection={<IconWand size={18} />} onClick={fillFrom24}>Fill gold from 24K</Button>}
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          {ROWS.map((r) => {
            const k = key(r.metal, r.purity);
            const current = rates.data?.find((x) => x.metal === r.metal && x.purity === r.purity);
            return isAdmin ? (
              <NumberInput
                key={k}
                label={`${r.metal === "gold" ? "Gold" : r.metal === "silver" ? "Silver" : "Platinum"} ${r.purity}`}
                description={current ? (current.is_today ? "set today" : `last: ${shortDate(current.effective_on)}`) : "not set"}
                thousandSeparator="," min={0} decimalScale={0}
                leftSection={<Text size="xs" c="dimmed">{fmt.currency_symbol}</Text>}
                rightSection={<Text size="xs" c="dimmed">/{perTola ? "tola" : "g"}</Text>}
                rightSectionWidth={44}
                value={shown(k)}
                onChange={(val) => setShown(k, val)}
              />
            ) : (
              <Card key={k} padding="sm" bg={r.metal === "gold" ? "gold.0" : "gray.0"} withBorder={false}>
                <Text size="xs" c="dimmed" tt="capitalize">{r.metal} {r.purity}</Text>
                {current ? <Money value={Number(current.rate_per_g) * factor} fw={700} /> : <Text c="dimmed">—</Text>}
                <Text size="xs" c="dimmed">per {perTola ? "tola" : "gram"}{current && !current.is_today ? ` · ${shortDate(current.effective_on)}` : ""}</Text>
              </Card>
            );
          })}
        </SimpleGrid>
        {isAdmin && (
          <Stack mt="lg" gap="xs">
            {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
            <Group justify="flex-end">
              <Button size="md" color="gold" loading={save.isPending} onClick={() => save.mutate()}>Save today's rates</Button>
            </Group>
          </Stack>
        )}
      </Card>

      <Card>
        <Title order={4} mb="sm">History</Title>
        {byDay.length === 0 ? <Text c="dimmed" size="sm">No history yet.</Text> : (
          <Table.ScrollContainer minWidth={500}>
            <Table verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  {ROWS.map((r) => <Table.Th key={key(r.metal, r.purity)} ta="right">{r.purity}</Table.Th>)}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {byDay.map(([day, list]) => (
                  <Table.Tr key={day}>
                    <Table.Td>{shortDate(day)}</Table.Td>
                    {ROWS.map((r) => {
                      const x = list.find((l) => l.metal === r.metal && l.purity === r.purity);
                      return <Table.Td key={key(r.metal, r.purity)} ta="right" ff="monospace" fz="sm">{x ? money(Number(x.rate_per_g) * factor) : ""}</Table.Td>;
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </>
  );
}
