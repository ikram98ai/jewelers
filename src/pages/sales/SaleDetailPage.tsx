import {
  Alert, Anchor, Badge, Button, Card, Divider, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text,
  TextInput, Textarea, Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconBan, IconCash, IconCheck, IconPrinter, IconShare, IconShieldLock } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorText, Loading, Money, StatusBadge } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { dateTime, methodLabel, money, num, oldGoldValue, PAYMENT_METHODS, phoneDisplay, PURITIES } from "@/lib/format";
import { unwrap, useRates, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { OldGoldReceipt, Payment, Sale, SaleItem, SaleReturn, SaleReturnItem } from "@/lib/types";

type FullSale = Sale & {
  clients: { id: string; full_name: string; phone: string; address: string | null; city: string | null } | null;
  seller: { full_name: string } | null;
  voider: { full_name: string } | null;
  sale_items: SaleItem[];
  payments: (Payment & { old_gold_receipts: OldGoldReceipt | null; profiles: { full_name: string } | null })[];
  sale_returns: (SaleReturn & { sale_return_items: SaleReturnItem[] })[];
};

export default function SaleDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { isAdmin } = useAuth();
  const { settings, fmt } = useSettings();
  const queryClient = useQueryClient();
  const [payOpen, pay] = useDisclosure(false);
  const [voidOpen, voidModal] = useDisclosure(false);
  const [returnOpen, returnModal] = useDisclosure(false);
  const navigate = useNavigate();

  const sale = useQuery({
    queryKey: ["sale", id],
    queryFn: async () => unwrap(await supabase.from("sales").select(`
      *,
      clients(id, full_name, phone, address, city),
      seller:profiles!sales_sold_by_fkey(full_name),
      voider:profiles!sales_voided_by_fkey(full_name),
      sale_items(*),
      payments(*, old_gold_receipts(*), profiles(full_name)),
      sale_returns(*, sale_return_items(*))
    `).eq("id", id).single()) as unknown as FullSale,
  });

  const refresh = () => ["sale", "sales", "dashboard", "client", "clients", "items", "item"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));

  if (sale.isLoading) return <Loading />;
  if (sale.error || !sale.data) return <ErrorText error={sale.error ?? "Sale not found"} />;
  const s = sale.data;
  const paid = s.payments.reduce((t, p) => t + Number(p.amount), 0);
  // Same formula as the sale_balances view: total − returned credit − paid + paid back out.
  const returnedCredit = s.sale_returns.reduce((t, r) => t + Number(r.credit), 0);
  const paidOut = s.sale_returns.reduce((t, r) => t + Number(r.refund_amount) + Number(r.exchange_amount), 0);
  const balance = s.status === "void" ? 0 : Number(s.total) - returnedCredit - paid + paidOut;
  const returnedQty = (saleItemId: string) => s.sale_returns.flatMap((r) => r.sale_return_items)
    .filter((x) => x.sale_item_id === saleItemId).reduce((t, x) => t + x.qty, 0);
  const lines = s.sale_items;

  const share = async () => {
    const text = `${settings?.shop_name}\nInvoice ${s.invoice_no} · ${dateTime(s.created_at)}\n` +
      lines.map((l) => `• ${l.item_name} (${l.item_tag}) ${money(l.final_price, fmt)}`).join("\n") +
      `\nTotal ${money(s.total, fmt)} · Paid ${money(paid, fmt)}${balance > 0 ? ` · Balance ${money(balance, fmt)}` : ""}`;
    if (navigator.share) await navigator.share({ title: s.invoice_no, text }).catch(() => undefined);
    else { await navigator.clipboard.writeText(text); notifications.show({ message: "Invoice copied" }); }
  };

  return (
    <>
      {params.get("new") && (
        <Alert color="green" icon={<IconCheck />} mb="md" className="no-print" title="Sale completed">
          Print the invoice or share it with the customer.
        </Alert>
      )}
      <Group justify="space-between" mb="md" className="no-print" gap="sm">
        <Group gap="xs">
          <Title order={2} fz={{ base: 24, sm: 30 }}>Invoice</Title>
          <StatusBadge status={s.status} size="lg" />
        </Group>
        <Group gap="xs" className="mobile-fill">
          {s.status === "completed" && balance > 0 && <Button color="gold" leftSection={<IconCash size={18} />} onClick={pay.open}>Add payment</Button>}
          <Button variant="default" leftSection={<IconShare size={18} />} onClick={share}>Share</Button>
          <Button variant="default" leftSection={<IconPrinter size={18} />} onClick={() => window.print()}>Print</Button>
          {s.status === "completed" && s.clients && (
            <Button variant="default" leftSection={<IconShieldLock size={18} />} component={Link} to={`/safekeeping/new?sale=${s.id}`}>Keep in safekeeping</Button>
          )}
          {isAdmin && s.status === "completed" && lines.some((l) => returnedQty(l.id) < l.qty) && (
            <Button variant="default" leftSection={<IconArrowBackUp size={18} />} onClick={returnModal.open}>Return / exchange</Button>
          )}
          {isAdmin && s.status === "completed" && s.sale_returns.length === 0 && <Button variant="subtle" color="red" leftSection={<IconBan size={18} />} onClick={voidModal.open}>Void</Button>}
        </Group>
      </Group>

      {s.sale_returns.map((r) => (
        <Alert key={r.id} color="blue" mb="md" className="no-print" icon={<IconArrowBackUp />} title={`Return ${r.return_no}`}>
          <Text size="sm">
            {r.sale_return_items.map((x) => lines.find((l) => l.id === x.sale_item_id)?.item_name).join(", ")} returned {dateTime(r.created_at)}
            {Number(r.deduction_pct) ? ` with ${r.deduction_pct}% deduction` : ""}: credit {money(r.credit, fmt)}.
            {Number(r.applied_to_due) > 0 && ` ${money(r.applied_to_due, fmt)} cancelled the balance due.`}
            {Number(r.refund_amount) > 0 && ` Refunded ${money(r.refund_amount, fmt)} (${methodLabel(r.settle)}).`}
            {Number(r.exchange_amount) > 0 && ` Exchange credit ${money(r.exchange_amount, fmt)}, ${money(Number(r.exchange_amount) - Number(r.exchange_used), fmt)} left.`}
            {" "}Reason: {r.reason}
          </Text>
          {Number(r.exchange_amount) - Number(r.exchange_used) > 0 && (
            <Button mt="xs" size="xs" onClick={() => navigate(`/sell?client=${s.client_id ?? ""}&exchange=${r.return_no}`)}>Use exchange credit in a new sale</Button>
          )}
        </Alert>
      ))}

      {s.status === "void" && (
        <Alert color="red" mb="md" title="This sale was voided">
          {s.void_reason} — by {s.voider?.full_name} on {dateTime(s.voided_at)}. Stock was returned.
        </Alert>
      )}

      <Card className="print-area" maw={820} mx="auto" p={{ base: "md", sm: "xl" }}>
        <Group justify="space-between" align="flex-start" mb="lg" gap="sm">
          <div style={{ minWidth: 0 }}>
            <Title order={2} ff="heading" fz={{ base: 22, sm: 30 }}>{settings?.shop_name}</Title>
            {settings?.address && <Text size="sm" c="dimmed">{settings.address}</Text>}
            {settings?.phone && <Text size="sm" c="dimmed">{settings.phone}</Text>}
          </div>
          <Stack gap={2} className="invoice-meta">
            <Text ff="monospace" fw={700} fz="lg">{s.invoice_no}</Text>
            <Text size="sm" c="dimmed">{dateTime(s.created_at)}</Text>
            <Text size="sm" c="dimmed">Served by {s.seller?.full_name}</Text>
          </Stack>
        </Group>

        <Card withBorder={false} bg="gray.0" padding="sm" mb="md">
          {s.clients ? (
            <Group justify="space-between">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Bill to</Text>
                <Anchor component={Link} to={`/clients/${s.clients.id}`} fw={600} c="dark">{s.clients.full_name}</Anchor>
                <Text size="sm">{phoneDisplay(s.clients.phone)}{s.clients.city ? ` · ${s.clients.city}` : ""}</Text>
              </div>
            </Group>
          ) : <Text size="sm" fw={500}>Walk-in customer</Text>}
        </Card>

        {/* Phone screens show Item + Amount, with the price breakdown under the item.
            Print always gets the full five columns (see .wide-only / .narrow-only). */}
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Item</Table.Th>
              <Table.Th ta="right" className="wide-only">Net wt</Table.Th>
              <Table.Th ta="right" className="wide-only">Rate/g</Table.Th>
              <Table.Th ta="right" className="wide-only">Making</Table.Th>
              <Table.Th ta="right">Amount</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((l) => {
              const wt = l.net_weight_g !== null && l.rate_per_g !== null ? `${Number(l.net_weight_g).toFixed(3)} g` : "";
              const rate = l.rate_per_g !== null ? money(l.rate_per_g) : "";
              const making = Number(l.making_amount) ? money(l.making_amount) : "";
              const breakdown = [wt && rate ? `${wt} × ${rate}` : wt || rate, making && `making ${making}`].filter(Boolean).join(" · ");
              return (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{l.item_name}{l.qty > 1 ? ` × ${l.qty}` : ""}</Text>
                    <Text size="xs" c="dimmed" ff="monospace">{l.item_tag}{l.purity ? ` · ${l.purity} ${l.metal}` : ""}</Text>
                    {breakdown && <Text size="xs" c="dimmed" ff="monospace" className="narrow-only">{breakdown}</Text>}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm" className="wide-only">{wt}</Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm" className="wide-only">{rate}</Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm" className="wide-only">{making}</Table.Td>
                  <Table.Td ta="right" style={{ verticalAlign: "top", whiteSpace: "nowrap" }}><Money value={l.final_price} fw={600} size="sm" /></Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>

        <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md" spacing="xl">
          <Stack gap={4}>
            {s.note && <><Text size="xs" c="dimmed" tt="uppercase" fw={600}>Note</Text><Text size="sm">{s.note}</Text></>}
            {s.payments.length > 0 && (
              <>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} mt="sm">Payments</Text>
                {s.payments.map((p) => (
                  <Group key={p.id} justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
                    <Text size="sm" miw={0}>
                      {methodLabel(p.method)}
                      {p.old_gold_receipts ? ` · ${Number(p.old_gold_receipts.gross_weight_g).toFixed(3)} g${Number(p.old_gold_receipts.stone_weight_g) ? ` less ${Number(p.old_gold_receipts.stone_weight_g).toFixed(3)} g stones` : ""} ${p.old_gold_receipts.purity} @ ${money(p.old_gold_receipts.rate_per_g)}${Number(p.old_gold_receipts.deduction_pct) ? ` −${p.old_gold_receipts.deduction_pct}%` : ""}` : ""}
                      {p.reference ? ` · ${p.reference}` : ""}
                      <Text span size="xs" c="dimmed"> · {dateTime(p.created_at)}</Text>
                    </Text>
                    <Money value={p.amount} size="sm" />
                  </Group>
                ))}
              </>
            )}
          </Stack>
          <Stack gap={6}>
            {Number(s.discount_total) > 0 && (
              <Group justify="space-between"><Text size="sm" c="dimmed">Discount</Text><Money value={s.discount_total} size="sm" /></Group>
            )}
            <Group justify="space-between"><Text fw={600}>Total</Text><Money value={s.total} fw={700} size="lg" /></Group>
            <Group justify="space-between"><Text size="sm" c="dimmed">Paid</Text><Money value={paid} size="sm" /></Group>
            <Divider />
            <Group justify="space-between">
              <Text fw={600}>Balance due</Text>
              <Money value={balance} fw={700} size="lg" c={balance > 0 ? "orange.8" : "green.8"} />
            </Group>
            {balance <= 0 && s.status === "completed" && <Badge color="green" variant="light" size="lg" style={{ alignSelf: "flex-end" }}>Paid in full</Badge>}
          </Stack>
        </SimpleGrid>

        <Text ta="center" size="xs" c="dimmed" mt="xl">Thank you for your purchase.</Text>
      </Card>

      {payOpen && <AddPaymentModal saleId={s.id} balance={balance} onClose={pay.close} onSaved={refresh} />}
      {voidOpen && <VoidModal saleId={s.id} invoice={s.invoice_no} onClose={voidModal.close} onSaved={refresh} />}
      {returnOpen && (
        <ReturnModal saleId={s.id} balanceDue={Math.max(0, balance)}
          lines={lines.map((l) => ({ ...l, remaining: l.qty - returnedQty(l.id) })).filter((l) => l.remaining > 0)}
          onClose={returnModal.close}
          onSaved={(r) => {
            refresh();
            if (r.exchange_credit > 0) navigate(`/sell?client=${s.client_id ?? ""}&exchange=${r.return_no}`);
          }} />
      )}
    </>
  );
}

function AddPaymentModal({ saleId, balance, onClose, onSaved }: { saleId: string; balance: number; onClose: () => void; onSaved: () => void }) {
  const { settings } = useSettings();
  const rates = useRates();
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState<number | string>(balance);
  const [reference, setReference] = useState("");
  const [og, setOg] = useState({ weight: "" as number | string, stone: 0 as number | string, purity: "22K", rate: (rates.rateFor("gold", "22K") ?? "") as number | string, deduction: "" as number | string });
  const deduction = og.deduction === "" ? Number(settings?.old_gold_deduction_pct ?? 0) : num(og.deduction);
  const ogValue = oldGoldValue(Math.max(0, (num(og.weight) ?? 0) - (num(og.stone) ?? 0)), num(og.rate), deduction);

  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("add_payment", {
      p_sale_id: saleId,
      p_payment: method === "old_gold"
        ? { method, old_gold: { gross_weight_g: num(og.weight), stone_weight_g: num(og.stone) ?? 0, purity: og.purity, rate_per_g: num(og.rate), deduction_pct: deduction } }
        : { method, amount: num(amount), reference: reference || undefined },
    })),
    onSuccess: () => { notifications.show({ color: "green", message: "Payment recorded" }); onSaved(); onClose(); },
  });

  return (
    <Modal opened onClose={onClose} title="Add payment">
      <Stack>
        <Text size="sm">Balance due: <Money value={balance} fw={700} /></Text>
        <Select label="Method" data={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))} value={method} onChange={(m) => setMethod(m ?? "cash")} />
        {method === "old_gold" ? (
          <SimpleGrid cols={2}>
            <NumberInput label="Weight (g)" decimalScale={3} value={og.weight} onChange={(v) => setOg({ ...og, weight: v })} />
            <NumberInput label="Stones (g)" decimalScale={3} min={0} value={og.stone} onChange={(v) => setOg({ ...og, stone: v })} />
            <Select label="Purity" data={PURITIES.gold} value={og.purity} onChange={(p) => setOg({ ...og, purity: p ?? "22K", rate: rates.rateFor("gold", p ?? "22K") ?? og.rate })} />
            <NumberInput label="Rate / g" thousandSeparator="," value={og.rate} onChange={(v) => setOg({ ...og, rate: v })} />
            <NumberInput label="Deduction %" placeholder={String(settings?.old_gold_deduction_pct ?? 0)} value={og.deduction} onChange={(v) => setOg({ ...og, deduction: v })} />
            <Text size="sm">Value: <Money value={ogValue} fw={700} /></Text>
          </SimpleGrid>
        ) : (
          <>
            <NumberInput label="Amount" thousandSeparator="," min={0} max={balance} value={amount} onChange={setAmount} />
            <TextInput label="Reference" placeholder="optional" value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
          </>
        )}
        {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="gold" loading={save.isPending} onClick={() => save.mutate()}>Record payment</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function VoidModal({ saleId, invoice, onClose, onSaved }: { saleId: string; invoice: string; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: reason })),
    onSuccess: () => { notifications.show({ color: "green", message: `${invoice} voided, stock returned` }); onSaved(); onClose(); },
  });
  return (
    <Modal opened onClose={onClose} title={`Void ${invoice}?`}>
      <Stack>
        <Text size="sm">Items go back into stock and the sale stops counting toward totals and balances. This cannot be undone. Note any refund in the reason.</Text>
        <Textarea label="Reason (required)" placeholder="e.g. Customer returned the ring, refunded cash" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Keep sale</Button>
          <Button color="red" disabled={reason.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>Void sale</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ReturnModal({ saleId, lines, balanceDue, onClose, onSaved }: {
  saleId: string; balanceDue: number;
  lines: (SaleItem & { remaining: number })[];
  onClose: () => void;
  onSaved: (r: { return_no: string; exchange_credit: number }) => void;
}) {
  const { fmt } = useSettings();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [deduction, setDeduction] = useState<number | string>(0);
  const [settle, setSettle] = useState("exchange");
  const [reason, setReason] = useState("");
  const toggle = (id: string, max: number) => setPicked((p) => (p[id] ? (({ [id]: _, ...rest }) => rest)(p) : { ...p, [id]: max }));
  const ded = Number(deduction) || 0;
  const credit = lines.reduce((t, l) => t + (picked[l.id] ? Math.round(Math.round(Number(l.final_price) * picked[l.id] / l.qty) * (1 - ded / 100)) : 0), 0);
  const applied = Math.min(balanceDue, credit);
  const out = credit - applied;

  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("return_sale_items", {
      p_sale_id: saleId, p_settle: settle, p_reason: reason, p_deduction_pct: ded,
      p_lines: Object.entries(picked).map(([sale_item_id, qty]) => ({ sale_item_id, qty })),
    })) as unknown as { return_no: string; exchange_credit: number },
    onSuccess: (r) => { notifications.show({ color: "green", message: `${r.return_no} recorded; items are back in stock` }); onSaved(r); onClose(); },
  });

  return (
    <Modal opened onClose={onClose} title="Return or exchange" size="lg">
      <Stack>
        <Text size="sm">Choose what the client is bringing back. Returned pieces go back into stock.</Text>
        <Stack gap={6}>
          {lines.map((l) => (
            <Card key={l.id} padding="xs" withBorder style={{ cursor: "pointer", borderColor: picked[l.id] ? "var(--mantine-color-gold-5)" : undefined }}
              onClick={() => toggle(l.id, l.remaining)}>
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm" fw={500}>{picked[l.id] ? "✓ " : ""}{l.item_name}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">{l.item_tag}{l.qty > 1 ? ` · ${l.remaining} of ${l.qty} left to return` : ""}</Text>
                </div>
                <Group gap="xs" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                  {l.qty > 1 && picked[l.id] !== undefined && (
                    <NumberInput size="xs" w={70} min={1} max={l.remaining} value={picked[l.id]} allowDecimal={false}
                      onChange={(v) => setPicked((p) => ({ ...p, [l.id]: Math.max(1, Math.min(Number(v) || 1, l.remaining)) }))} />
                  )}
                  <Money value={l.final_price} size="sm" />
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
        <SimpleGrid cols={2}>
          <NumberInput label="Deduction %" description="e.g. making charges kept by the shop" min={0} max={50} decimalScale={2} value={deduction} onChange={setDeduction} />
          <Select label="Give the money back as" value={settle} onChange={(v) => setSettle(v ?? "exchange")}
            data={[{ value: "exchange", label: "Exchange credit (new purchase)" }, { value: "cash", label: "Cash refund" }, { value: "bank_transfer", label: "Bank refund" }]} />
        </SimpleGrid>
        <TextInput label="Reason (required)" placeholder="e.g. Size too small, client wants a different design" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <Card bg="gray.0" withBorder={false} padding="sm">
          <Group justify="space-between"><Text size="sm">Credit for returned items</Text><Money value={credit} fw={600} /></Group>
          {applied > 0 && <Group justify="space-between"><Text size="sm" c="dimmed">Cancels the balance still owed</Text><Money value={applied} /></Group>}
          <Group justify="space-between"><Text size="sm" fw={600}>{settle === "exchange" ? "Exchange credit" : "Refund to client"}</Text><Money value={out} fw={700} /></Group>
          {settle === "exchange" && out > 0 && <Text size="xs" c="dimmed">Next you'll start a new sale with this credit as the payment.</Text>}
          <Text size="xs" c="dimmed">{fmt.currency_code}</Text>
        </Card>
        {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={!Object.keys(picked).length || reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Record return</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
