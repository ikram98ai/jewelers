import {
  ActionIcon, Alert, Button, Card, Divider, Grid, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClientSelect } from "@/components/ClientSelect";
import { Money, PageHeader } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { METALS, num, PURITIES } from "@/lib/format";
import { unwrap, useCategories, useRates } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Client } from "@/lib/types";

type N = number | string;
interface Line {
  key: string; description: string; metal: string; purity: string | null; gross: N; stone: N;
  pricing: "rate" | "agreed"; rate: N; deduction: N; agreed: N;
  destination: "stock" | "melt"; category_id: string | null; making: N;
}

export default function PurchaseNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const rates = useRates();
  const buyRate = (metal: string, purity: string | null) => {
    const r = rates.rateFor(metal, purity);
    return r ? Math.floor((r * 0.97) / 10) * 10 : "";   // the shop buys a little under its selling rate
  };
  const newLine = (): Line => ({
    key: crypto.randomUUID(), description: "", metal: "gold", purity: "22K", gross: "", stone: 0,
    pricing: "rate", rate: buyRate("gold", "22K"), deduction: 3, agreed: "", destination: "stock", category_id: null, making: 1200,
  });
  const [client, setClient] = useState<Client | null>(null);
  const [idNote, setIdNote] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  // This form can mount before today's rates arrive: fill in any rate still blank once they do.
  useEffect(() => {
    setLines((ls) => ls.map((l) => (l.pricing === "rate" && l.rate === "" ? { ...l, rate: buyRate(l.metal, l.purity) } : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buyRate is rebuilt each render; only new rates matter
  }, [rates.data]);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const value = (l: Line) => {
    if (l.pricing === "agreed") return num(l.agreed) ?? 0;
    const net = (num(l.gross) ?? 0) - (num(l.stone) ?? 0);
    return Math.round(Math.max(0, net) * (num(l.rate) ?? 0) * (1 - (num(l.deduction) ?? 0) / 100));
  };
  const total = lines.reduce((s, l) => s + value(l), 0);
  const problems = [
    !client && "Choose who you are buying from (add them as a client).",
    lines.some((l) => !l.description.trim()) && "Describe every piece.",
    lines.some((l) => l.pricing === "rate" && !(num(l.gross)! > 0)) && "Enter the weight to price by rate.",
    lines.some((l) => l.destination === "stock" && !l.category_id) && "Choose a category for pieces going into stock.",
    total <= 0 && "Nothing to pay.",
  ].filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("buy_from_client", {
      p_client_id: client!.id, p_method: method, p_reference: reference || undefined,
      p_seller_id_note: idNote || undefined, p_note: note || undefined,
      p_lines: lines.map((l) => ({
        description: l.description.trim(), metal: l.metal, purity: l.metal === "other" ? null : l.purity,
        gross_weight_g: num(l.gross), stone_weight_g: num(l.stone) ?? 0,
        ...(l.pricing === "rate" ? { rate_per_g: num(l.rate), deduction_pct: num(l.deduction) ?? 0 } : { value: num(l.agreed) }),
        destination: l.destination, category_id: l.category_id, making_charge: num(l.making) ?? 0,
        ...(l.metal === "other" && l.destination === "stock" ? { fixed_price: Math.round(value(l) * 1.3) } : {}),
      })),
    })) as unknown as { purchase_id: string },
    onSuccess: (r) => {
      ["purchases", "melt-pool", "items", "dashboard"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      navigate(`/purchases/${r.purchase_id}?new=1`, { replace: true });
    },
  });

  return (
    <>
      <PageHeader title="Buy from client" subtitle="Used jewellery, sets or old gold. Price by weight × rate, or an agreed amount." />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card>
              <ClientSelect label="Seller" value={client} onChange={setClient} />
              <TextInput mt="sm" label="Seller ID checked" placeholder="e.g. CNIC seen, last 4 digits 1234" value={idNote} onChange={(e) => setIdNote(e.currentTarget.value)} />
            </Card>
            <Card>
              <Group justify="space-between" mb="sm">
                <Title order={4}>Pieces</Title>
                <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, newLine()])}>Add piece</Button>
              </Group>
              <Stack gap="sm">
                {lines.map((l, i) => (
                  <Card key={l.key} padding="sm" bg="gray.0" withBorder={false}>
                    <Group gap="xs" align="flex-end" wrap="nowrap">
                      <TextInput flex={1} size="sm" label="Description" placeholder="e.g. Used bridal set, old kara, broken chain"
                        value={l.description} onChange={(e) => set(i, { description: e.currentTarget.value })} />
                      <Stack gap={0} align="flex-end"><Text size="xs" c="dimmed">Value</Text><Money value={value(l)} fw={700} /></Stack>
                      {lines.length > 1 && <ActionIcon variant="subtle" color="red" size="lg" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove"><IconTrash size={18} /></ActionIcon>}
                    </Group>
                    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mt="xs">
                      <Select size="sm" label="Metal" data={METALS.map((m) => ({ value: m.value, label: m.label }))} value={l.metal}
                        onChange={(m) => { const p = PURITIES[m ?? "gold"]?.[0] ?? null; set(i, { metal: m ?? "gold", purity: p, rate: buyRate(m ?? "gold", p), pricing: m === "other" ? "agreed" : l.pricing }); }} />
                      {l.metal !== "other" ? <Select size="sm" label="Purity" data={PURITIES[l.metal] ?? []} value={l.purity}
                        onChange={(p) => set(i, { purity: p, rate: buyRate(l.metal, p) })} /> : <div />}
                      <NumberInput size="sm" label="Gross weight (g)" decimalScale={3} min={0} value={l.gross} onChange={(v) => set(i, { gross: v })} />
                      <NumberInput size="sm" label="Stone weight (g)" decimalScale={3} min={0} value={l.stone} onChange={(v) => set(i, { stone: v })} />
                    </SimpleGrid>
                    <Group mt="xs" gap="xs" align="flex-end" wrap="wrap">
                      <SegmentedControl size="xs" value={l.pricing} onChange={(v) => set(i, { pricing: v as Line["pricing"] })}
                        data={[{ value: "rate", label: "By rate" }, { value: "agreed", label: "Agreed amount" }]} />
                      {l.pricing === "rate" ? (
                        <>
                          <NumberInput size="sm" w={130} label="Buying rate / g" thousandSeparator="," value={l.rate} onChange={(v) => set(i, { rate: v })} />
                          <NumberInput size="sm" w={110} label="Deduction %" min={0} max={50} decimalScale={2} value={l.deduction} onChange={(v) => set(i, { deduction: v })} />
                        </>
                      ) : (
                        <NumberInput size="sm" w={160} label="Agreed amount" thousandSeparator="," min={0} value={l.agreed} onChange={(v) => set(i, { agreed: v })} />
                      )}
                    </Group>
                    <Divider my="xs" />
                    <Group gap="xs" align="flex-end" wrap="wrap">
                      <SegmentedControl size="xs" value={l.destination} onChange={(v) => set(i, { destination: v as Line["destination"] })}
                        data={[{ value: "stock", label: "Put in stock to resell" }, { value: "melt", label: "For melting" }]} />
                      {l.destination === "stock" && (
                        <>
                          <Select size="sm" w={170} label="Category" placeholder="Choose" data={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                            value={l.category_id} onChange={(c) => set(i, { category_id: c })} />
                          {l.metal !== "other" && <NumberInput size="sm" w={140} label="Making to charge / g" min={0} value={l.making} onChange={(v) => set(i, { making: v })} />}
                        </>
                      )}
                    </Group>
                    {l.destination === "stock" && categories.data?.find((c) => c.id === l.category_id)?.name === "Set" && (
                      <Text size="xs" c="dimmed" mt={6}>After saving, open the new set to list its parts (necklace, earrings, bangles…) with photos.</Text>
                    )}
                  </Card>
                ))}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card style={{ position: "sticky", top: 80 }}>
            <Stack>
              <Group justify="space-between"><Text fw={600}>Pay the client</Text><Money value={total} fw={700} size="lg" /></Group>
              <Select label="Paid by" data={[{ value: "cash", label: "Cash" }, { value: "bank_transfer", label: "Bank transfer" }]} value={method} onChange={(m) => setMethod(m ?? "cash")} />
              {method === "bank_transfer" && <TextInput label="Reference" value={reference} onChange={(e) => setReference(e.currentTarget.value)} />}
              <Textarea label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
              {problems.length > 0 && <Alert color="orange" p="xs">{problems.map((p) => <Text key={p} size="xs">{p}</Text>)}</Alert>}
              {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
              <Button size="lg" color="gold" disabled={problems.length > 0} loading={save.isPending} onClick={() => save.mutate()}>Save &amp; pay</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}
