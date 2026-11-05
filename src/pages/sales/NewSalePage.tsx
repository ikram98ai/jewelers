import {
  ActionIcon, Alert, Badge, Box, Button, Card, Combobox, Divider, Flex, Grid, Group, InputBase, Loader, NumberInput,
  Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title, useCombobox,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconSearch, IconTrash, IconUserPlus, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ItemThumb } from "@/components/ItemThumb";
import { ScanButton } from "@/components/ScanButton";
import { Money, PageHeader, PurityBadge, Weight } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { methodLabel, num, oldGoldValue, PAYMENT_METHODS, PURITIES, phoneDisplay } from "@/lib/format";
import { useRates, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Client } from "@/lib/types";
import { ClientFormModal } from "../clients/ClientFormModal";
import classes from "./NewSalePage.module.css";

interface SaleItemRow {
  id: string; tag: string; name: string; tracking: string; metal: string; purity: string | null;
  net_weight_g: number | null; qty_on_hand: number; suggested_price: number | null;
}
interface Line { item: SaleItemRow; qty: number; final: number | string }
interface PaymentRow {
  key: string; method: string; amount: number | string; reference: string;
  og_weight: number | string; og_purity: string; og_rate: number | string; og_deduction: number | string; og_description: string;
}

const newPayment = (method = "cash", amount: number | string = ""): PaymentRow => ({
  key: crypto.randomUUID(), method, amount, reference: "",
  og_weight: "", og_purity: "22K", og_rate: "", og_deduction: "", og_description: "",
});

export default function NewSalePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { settings } = useSettings();
  const rates = useRates();

  const [client, setClient] = useState<Client | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [note, setNote] = useState("");

  // Preload ?item=<id> (from the item page "Sell" button).
  const preloadId = params.get("item");
  useEffect(() => {
    if (!preloadId) return;
    supabase.from("items").select("id, tag, name, tracking, metal, purity, net_weight_g, qty_on_hand, suggested_price")
      .eq("id", preloadId).eq("status", "in_stock").maybeSingle()
      .then(({ data }) => { if (data) addItem(data as unknown as SaleItemRow); });
  }, [preloadId]);

  // From a return: ?client=<id>&exchange=<RET-…> pre-fills the client and the credit as a payment.
  const preClient = params.get("client");
  const preExchange = params.get("exchange");
  useEffect(() => {
    if (preClient) {
      supabase.from("clients").select("*").eq("id", preClient).maybeSingle().then(({ data }) => { if (data) setClient(data as Client); });
    }
    if (preExchange) {
      supabase.from("sale_returns").select("return_no, exchange_amount, exchange_used").eq("return_no", preExchange).maybeSingle()
        .then(({ data }) => {
          const left = data ? Number(data.exchange_amount) - Number(data.exchange_used) : 0;
          if (data && left > 0) {
            setPayments((ps) => ps.some((x) => x.method === "exchange") ? ps : [...ps, { ...newPayment("exchange", left), reference: data.return_no }]);
          }
        });
    }
  }, [preClient, preExchange]);

  const addItem = (item: SaleItemRow) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.item.id === item.id);
      if (existing) {
        if (item.tracking === "piece") {
          notifications.show({ color: "orange", message: `${item.tag} is already in this sale` });
          return ls;
        }
        return ls.map((l) => (l.item.id === item.id ? { ...l, qty: Math.min(l.qty + 1, item.qty_on_hand), final: (item.suggested_price ?? 0) * Math.min(l.qty + 1, item.qty_on_hand) } : l));
      }
      return [...ls, { item, qty: 1, final: item.suggested_price ?? "" }];
    });
  };

  const subtotal = lines.reduce((s, l) => s + (l.item.suggested_price ?? 0) * l.qty, 0);
  const total = lines.reduce((s, l) => s + (num(l.final) ?? 0), 0);
  const paymentAmount = (p: PaymentRow) =>
    p.method === "old_gold"
      ? oldGoldValue(num(p.og_weight), num(p.og_rate), p.og_deduction === "" ? Number(settings?.old_gold_deduction_pct ?? 0) : num(p.og_deduction)) ?? 0
      : num(p.amount) ?? 0;
  const paid = payments.reduce((s, p) => s + paymentAmount(p), 0);
  const balance = total - paid;
  const discount = subtotal - total;

  const problems: string[] = [];
  if (lines.length === 0) problems.push("Add at least one item.");
  if (!client && !walkIn) problems.push("Choose a client or Walk-in.");
  if (lines.some((l) => l.final === "" || (num(l.final) ?? -1) < 0)) problems.push("Enter a final price for every item.");
  if (balance < 0) problems.push("Payments are more than the total.");
  if (walkIn && balance > 0 && lines.length > 0) problems.push("Walk-in sales must be paid in full.");
  if (payments.some((p) => p.method === "exchange" && !p.reference.trim())) problems.push("Enter the exchange credit number (RET-…).");

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_sale", {
        p_client_id: walkIn ? undefined : client?.id,
        p_note: note || undefined,
        p_lines: lines.map((l) => ({ item_id: l.item.id, qty: l.qty, final_price: num(l.final) })),
        p_payments: payments.filter((p) => paymentAmount(p) > 0).map((p) => p.method === "old_gold"
          ? {
              method: "old_gold",
              old_gold: {
                gross_weight_g: num(p.og_weight), purity: p.og_purity, rate_per_g: num(p.og_rate),
                deduction_pct: p.og_deduction === "" ? undefined : num(p.og_deduction), description: p.og_description || undefined,
              },
            }
          : { method: p.method, amount: num(p.amount), reference: (p.method === "exchange" ? p.reference.trim().toUpperCase() : p.reference) || undefined }),
      });
      if (error) throw error;
      return data as unknown as { sale_id: string; invoice_no: string };
    },
    onSuccess: (r) => {
      ["items", "item", "dashboard", "sales", "clients", "client"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      notifications.show({ color: "green", title: "Sale saved", message: r.invoice_no });
      navigate(`/sales/${r.sale_id}?new=1`, { replace: true });
    },
  });

  return (
    <>
      <PageHeader title="New sale" subtitle="Client → items → payment. Prices use today's rates." />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card>
              <Title order={4} mb="sm">1. Client</Title>
              <ClientPicker
                client={client} walkIn={walkIn}
                onClient={(c) => { setClient(c); setWalkIn(false); }}
                onWalkIn={() => { setClient(null); setWalkIn(true); }}
                onClear={() => { setClient(null); setWalkIn(false); }}
              />
            </Card>

            <Card>
              <Title order={4} mb="sm">2. Items</Title>
              <ItemSearch onPick={addItem} />
              <Stack gap="xs" mt="md">
                {lines.length === 0 && <Text c="dimmed" size="sm">Scan a tag or search to add items.</Text>}
                {lines.map((l, i) => (
                  <Card key={l.item.id} padding="sm" bg="gray.0" withBorder={false}>
                    {/* Phones: item details on top, price inputs full width below. */}
                    <Flex direction={{ base: "column", sm: "row" }} gap="xs" justify="space-between" align={{ base: "stretch", sm: "flex-start" }}>
                      <Group gap="xs" wrap="nowrap" align="flex-start" justify="space-between" miw={0} flex={1}>
                        <Stack gap={2} miw={0}>
                          <Text fw={600} size="sm" truncate>{l.item.name}</Text>
                          <Group gap={6}>
                            <Text size="xs" ff="monospace" c="dimmed">{l.item.tag}</Text>
                            <PurityBadge metal={l.item.metal} purity={l.item.purity} />
                            {l.item.tracking === "piece" && <Weight grams={l.item.net_weight_g} size="xs" />}
                          </Group>
                          <Text size="xs" c="dimmed">Today's price: <Money value={(l.item.suggested_price ?? 0) * l.qty} size="xs" /></Text>
                        </Stack>
                        <ActionIcon variant="subtle" color="red" size="lg" hiddenFrom="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove">
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Group>
                      <Group gap="xs" wrap="nowrap" align="flex-end">
                        {l.item.tracking === "bulk" && (
                          <NumberInput label="Qty" w={{ base: 80, sm: 70 }} size="sm" min={1} max={l.item.qty_on_hand} allowDecimal={false} value={l.qty}
                            onChange={(q) => {
                              const qty = Math.max(1, Math.min(Number(q) || 1, l.item.qty_on_hand));
                              setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty, final: (x.item.suggested_price ?? 0) * qty } : x)));
                            }} />
                        )}
                        <NumberInput label="Final price" flex={{ base: 1, sm: "0 0 130px" }} miw={0} size="sm" min={0} thousandSeparator="," value={l.final}
                          onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, final: v } : x)))} />
                        <ActionIcon variant="subtle" color="red" size="lg" visibleFrom="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove">
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Group>
                    </Flex>
                  </Card>
                ))}
              </Stack>
            </Card>

            <Card>
              <Group justify="space-between" mb="sm" gap="xs">
                <Title order={4}>3. Payment</Title>
                <Group gap="xs" className="mobile-fill">
                  {balance > 0 && (
                    <Button size="xs" variant="light" onClick={() => setPayments((ps) => [...ps, newPayment("cash", balance)])}>
                      Cash for full balance
                    </Button>
                  )}
                  <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setPayments((ps) => [...ps, newPayment()])}>Add payment</Button>
                </Group>
              </Group>
              <Stack gap="sm">
                {payments.length === 0 && <Text c="dimmed" size="sm">No payment yet. {client ? "The full amount will be the client's balance." : ""}</Text>}
                {payments.map((p, i) => (
                  <PaymentEditor
                    key={p.key}
                    p={p}
                    defaultDeduction={Number(settings?.old_gold_deduction_pct ?? 0)}
                    rateFor={(purity) => rates.rateFor("gold", purity)}
                    value={paymentAmount(p)}
                    onChange={(np) => setPayments((ps) => ps.map((x, j) => (j === i ? np : x)))}
                    onRemove={() => setPayments((ps) => ps.filter((_, j) => j !== i))}
                  />
                ))}
              </Stack>
            </Card>
            <Textarea label="Note on invoice (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card className={classes.summary}>
            <Stack gap="xs">
              <Title order={4}>Summary</Title>
              <Group justify="space-between"><Text size="sm" c="dimmed">Today's price</Text><Money value={subtotal} /></Group>
              {discount !== 0 && (
                <Group justify="space-between"><Text size="sm" c="dimmed">{discount > 0 ? "Discount" : "Above today's price"}</Text><Money value={Math.abs(discount)} c={discount > 0 ? "orange.8" : "green.8"} /></Group>
              )}
              <Group justify="space-between"><Text fw={600}>Total</Text><Money value={total} fw={700} size="lg" /></Group>
              <Divider />
              {payments.filter((p) => paymentAmount(p) > 0).map((p) => (
                <Group key={p.key} justify="space-between"><Text size="sm" c="dimmed">{methodLabel(p.method)}</Text><Money value={paymentAmount(p)} /></Group>
              ))}
              <Group justify="space-between">
                <Text fw={600}>{balance > 0 ? "Balance due" : balance < 0 ? "Overpaid" : "Balance"}</Text>
                <Money value={Math.abs(balance)} fw={700} size="lg" c={balance > 0 ? "orange.8" : balance < 0 ? "red" : "green.8"} />
              </Group>
              {client && balance > 0 && <Text size="xs" c="dimmed">Will be added to {client.full_name}'s balance.</Text>}
              {problems.length > 0 && lines.length > 0 && <Alert color="orange" p="xs">{problems.map((x) => <Text key={x} size="xs">{x}</Text>)}</Alert>}
              {submit.error && <Alert color="red">{friendlyError(submit.error)}</Alert>}
              <Button size="lg" color="gold" mt="xs" visibleFrom="md" disabled={problems.length > 0} loading={submit.isPending} onClick={() => submit.mutate()}>
                Complete sale
              </Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Phones and tablets: totals and the Complete button stay within thumb reach above the tab bar. */}
      <Box hiddenFrom="md" className={classes.checkoutBar}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Stack gap={0} miw={0}>
            <Text size="xs" c="dimmed">Total</Text>
            <Money value={total} fw={700} />
            {balance !== 0 && (
              <Text size="xs" c={balance > 0 ? "orange.8" : "red"} truncate>
                {balance > 0 ? "Due" : "Overpaid"} <Money value={Math.abs(balance)} size="xs" fw={600} />
              </Text>
            )}
          </Stack>
          <Button size="md" color="gold" disabled={problems.length > 0} loading={submit.isPending} onClick={() => submit.mutate()} style={{ flexShrink: 0 }}>
            Complete sale
          </Button>
        </Group>
        {problems.length > 0 && lines.length > 0 && <Text size="xs" c="orange.8" mt={4}>{problems[0]}</Text>}
      </Box>
    </>
  );
}

function PaymentEditor({ p, value, onChange, onRemove, rateFor, defaultDeduction }: {
  p: PaymentRow; value: number; onChange: (p: PaymentRow) => void; onRemove: () => void;
  rateFor: (purity: string) => number | null; defaultDeduction: number;
}) {
  const set = (patch: Partial<PaymentRow>) => onChange({ ...p, ...patch });
  const hasRef = p.method === "card" || p.method === "bank_transfer" || p.method === "other" || p.method === "exchange";
  return (
    <Card padding="sm" bg="gray.0" withBorder={false}>
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          {/* Phones: method on its own row, then amount + reference side by side. */}
          <Grid gutter="xs" align="flex-end" flex={1} miw={0}>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select size="sm" label="Method" data={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))} value={p.method}
                onChange={(m) => set({ method: m ?? "cash", og_rate: m === "old_gold" && p.og_rate === "" ? (rateFor(p.og_purity) ?? "") : p.og_rate })} />
            </Grid.Col>
            <Grid.Col span={hasRef ? { base: 6, sm: 4 } : { base: 12, sm: 8 }}>
              {p.method === "old_gold" ? (
                <Stack gap={0}><Text size="sm" fw={500}>Value</Text><Money value={value} fw={700} /></Stack>
              ) : (
                <NumberInput size="sm" label="Amount" min={0} thousandSeparator="," value={p.amount} onChange={(v) => set({ amount: v })} />
              )}
            </Grid.Col>
            {hasRef && (
              <Grid.Col span={{ base: 6, sm: 4 }}>
                <TextInput size="sm" label={p.method === "exchange" ? "Credit no." : "Reference"} placeholder={p.method === "exchange" ? "RET-2026-…" : "optional"}
                  value={p.reference} onChange={(e) => set({ reference: e.currentTarget.value })}
                  error={p.method === "exchange" && !p.reference.trim() ? "Required" : undefined} />
              </Grid.Col>
            )}
          </Grid>
          <ActionIcon variant="subtle" color="red" size="lg" mt={26} onClick={onRemove} aria-label="Remove payment"><IconX size={18} /></ActionIcon>
        </Group>
        {p.method === "old_gold" && (
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <NumberInput size="sm" label="Weight (g)" decimalScale={3} min={0} value={p.og_weight} onChange={(v) => set({ og_weight: v })} />
            <Select size="sm" label="Purity" data={PURITIES.gold} value={p.og_purity}
              onChange={(x) => set({ og_purity: x ?? "22K", og_rate: rateFor(x ?? "22K") ?? p.og_rate })} />
            <NumberInput size="sm" label="Rate / g" min={0} thousandSeparator="," value={p.og_rate} onChange={(v) => set({ og_rate: v })} />
            <NumberInput size="sm" label="Deduction %" min={0} max={50} decimalScale={2} placeholder={String(defaultDeduction)} value={p.og_deduction} onChange={(v) => set({ og_deduction: v })} />
          </SimpleGrid>
        )}
      </Stack>
    </Card>
  );
}

function ClientPicker({ client, walkIn, onClient, onWalkIn, onClear }: {
  client: Client | null; walkIn: boolean; onClient: (c: Client) => void; onWalkIn: () => void; onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 200);
  const [newOpen, setNewOpen] = useState(false);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const results = useQuery({
    queryKey: ["clients", "pick", debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_clients", { p_q: debounced }).limit(8);
      if (error) throw error;
      return data as Client[];
    },
  });

  if (client || walkIn) {
    return (
      <Group justify="space-between" wrap="nowrap">
        {client ? (
          <div style={{ minWidth: 0 }}><Text fw={600} truncate>{client.full_name}</Text><Text size="sm" c="dimmed">{phoneDisplay(client.phone)}{client.city ? ` · ${client.city}` : ""}</Text></div>
        ) : <Badge size="lg" color="gray">Walk-in customer</Badge>}
        <Button variant="subtle" size="xs" onClick={() => { setSearch(""); onClear(); }}>Change</Button>
      </Group>
    );
  }

  return (
    <>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Combobox store={combobox} onOptionSubmit={(id) => {
          const c = results.data?.find((x) => x.id === id);
          if (c) onClient(c);
          combobox.closeDropdown();
        }}>
          <Combobox.Target>
            <InputBase
              flex={1}
              miw={0}
              leftSection={<IconSearch size={18} />}
              rightSection={results.isFetching ? <Loader size="xs" /> : null}
              placeholder="Search phone or name"
              value={search}
              inputMode="search"
              onChange={(e) => { setSearch(e.currentTarget.value); combobox.openDropdown(); }}
              onFocus={() => combobox.openDropdown()}
              onBlur={() => combobox.closeDropdown()}
            />
          </Combobox.Target>
          <Combobox.Dropdown hidden={debounced.trim().length < 2}>
            <Combobox.Options>
              {(results.data ?? []).map((c) => (
                <Combobox.Option value={c.id} key={c.id}>
                  <Text size="sm" fw={500}>{c.full_name}</Text>
                  <Text size="xs" c="dimmed">{phoneDisplay(c.phone)}{c.city ? ` · ${c.city}` : ""}</Text>
                </Combobox.Option>
              ))}
              {results.data?.length === 0 && <Combobox.Empty>No client found</Combobox.Empty>}
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>
        <Button variant="light" leftSection={<IconUserPlus size={18} />} onClick={() => setNewOpen(true)}>New</Button>
      </Group>
      <Button mt="xs" variant="subtle" size="compact-sm" color="gray" onClick={onWalkIn}>Walk-in customer (no client record)</Button>
      {newOpen && (
        <ClientFormModal opened onClose={() => setNewOpen(false)} initialPhone={/^\d+$/.test(search.replace(/\D/g, "")) ? search : ""} onSaved={onClient} />
      )}
    </>
  );
}

function ItemSearch({ onPick }: { onPick: (i: SaleItemRow) => void }) {
  const [q, setQ] = useState("");
  const [debounced] = useDebouncedValue(q, 200);
  const results = useQuery({
    queryKey: ["items", "sell", debounced],
    enabled: debounced.trim().length >= 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_items", { p_q: debounced, p_status: "in_stock" })
        .select("id, tag, name, tracking, metal, purity, net_weight_g, qty_on_hand, suggested_price").gt("qty_on_hand", 0).limit(8);
      if (error) throw error;
      return data as unknown as SaleItemRow[];
    },
  });

  const pick = (i: SaleItemRow) => { onPick(i); setQ(""); };
  const onScan = async (text: string) => {
    const { data } = await supabase.from("items")
      .select("id, tag, name, tracking, metal, purity, net_weight_g, qty_on_hand, suggested_price")
      .eq("tag", text.trim().toUpperCase()).maybeSingle();
    const item = data as unknown as SaleItemRow | null;
    if (!item) return notifications.show({ color: "orange", message: `No item with tag ${text}` });
    if (item.qty_on_hand < 1) return notifications.show({ color: "red", message: `${item.tag} is not in stock` });
    pick(item);
  };

  return (
    <Stack gap="xs">
      <Group gap="sm" wrap="nowrap">
        <TextInput flex={1} miw={0} leftSection={<IconSearch size={18} />} placeholder="Tag, name or weight"
          value={q} onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (results.data?.length === 1) pick(results.data[0]); else onScan(q); } }} />
        <ScanButton compact onScan={onScan} />
      </Group>
      {debounced && (results.data ?? []).map((i) => (
        <Card key={i.id} padding="xs" onClick={() => pick(i)} style={{ cursor: "pointer" }}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" miw={0}>
              <ItemThumb size={36} />
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>{i.name}</Text>
                <Text size="xs" c="dimmed" ff="monospace">{i.tag} · {i.purity ?? i.metal}{i.tracking === "bulk" ? ` · ${i.qty_on_hand} left` : i.net_weight_g ? ` · ${Number(i.net_weight_g).toFixed(3)} g` : ""}</Text>
              </div>
            </Group>
            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}><Money value={i.suggested_price} fw={600} size="sm" /><IconPlus size={16} /></Group>
          </Group>
        </Card>
      ))}
      {debounced && results.data?.length === 0 && <Text size="sm" c="dimmed">No items in stock match “{debounced}”.</Text>}
    </Stack>
  );
}
