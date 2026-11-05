import { Badge, Button, Card, Group, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconPlus, IconSearch, IconShieldLock } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ScanButton } from "@/components/ScanButton";
import { EmptyState, ErrorText, Loading, PageHeader, StatCard } from "@/components/ui";
import { notifications } from "@mantine/notifications";
import { phoneDisplay, shortDate, weight } from "@/lib/format";
import { unwrap, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

type Row = {
  id: string; receipt_no: string; status: string; received_at: string; returned_at: string | null; sale_id: string | null;
  clients: { full_name: string; phone: string } | null;
  custody_items: { description: string; qty: number; gross_weight_g: number | null; purity: string | null; metal: string }[];
};
type Summary = { receipts_held: number; by_purity: { metal: string; purity: string; weight_g: number }[] };

export default function SafekeepingListPage() {
  const navigate = useNavigate();
  const { unit } = useSettings();
  const [status, setStatus] = useState("held");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["custody", status],
    queryFn: async () => {
      let req = supabase.from("custody_receipts")
        .select("id, receipt_no, status, received_at, returned_at, sale_id, clients(full_name, phone), custody_items(description, qty, gross_weight_g, purity, metal)")
        .order("received_at", { ascending: false }).limit(300);
      if (status !== "all") req = req.eq("status", status);
      return unwrap(await req) as unknown as Row[];
    },
  });
  const summary = useQuery({
    queryKey: ["custody", "summary"],
    queryFn: async () => unwrap(await supabase.rpc("custody_summary")) as unknown as Summary,
  });

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, "");
    return (list.data ?? []).filter((r) => !t || r.receipt_no.toLowerCase().includes(t)
      || r.clients?.full_name.toLowerCase().includes(t) || (digits.length >= 3 && r.clients?.phone.includes(digits)));
  }, [list.data, q]);

  const openByNumber = async (text: string) => {
    const { data } = await supabase.from("custody_receipts").select("id").eq("receipt_no", text.trim().toUpperCase()).maybeSingle();
    if (data) navigate(`/safekeeping/${data.id}`);
    else notifications.show({ color: "orange", message: `No safekeeping receipt ${text}` });
  };

  return (
    <>
      <PageHeader
        title="Safekeeping (amanat)"
        subtitle="Gold the shop is holding for clients, released only against the original receipt"
        actions={
          <>
            <ScanButton label="Scan receipt" onScan={openByNumber} />
            <Button leftSection={<IconPlus size={18} />} component={Link} to="/safekeeping/new">New receipt</Button>
          </>
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
        <StatCard label="Receipts open" value={summary.data?.receipts_held ?? "—"} icon={<IconShieldLock size={22} />} accent="gold" />
        {(summary.data?.by_purity ?? []).map((p) => (
          <StatCard key={`${p.metal}-${p.purity}`} label={`Held · ${p.purity} ${p.metal}`} value={weight(p.weight_g, unit).split(" · ")[0]}
            hint={unit === "tola" ? weight(p.weight_g, unit).split(" · ")[1] : undefined} />
        ))}
      </SimpleGrid>

      <Card mb="md" padding="md">
        <Group gap="sm" wrap="wrap">
          <TextInput flex={1} miw={220} leftSection={<IconSearch size={18} />} placeholder="Receipt number, client name or phone"
            value={q} onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter" && /^AMN-/i.test(q)) openByNumber(q); }} />
          <SegmentedControl value={status} onChange={setStatus}
            data={[{ value: "held", label: "Held" }, { value: "returned", label: "Returned" }, { value: "all", label: "All" }]} />
        </Group>
      </Card>

      <ErrorText error={list.error} />
      {list.isLoading ? <Loading /> : rows.length === 0 ? (
        <EmptyState title={status === "held" ? "Nothing held for clients" : "No receipts"}>Issue a receipt when a client leaves gold with the shop.</EmptyState>
      ) : (
        <>
          <Card padding={0} visibleFrom="sm">
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Receipt</Table.Th><Table.Th>Client</Table.Th><Table.Th>Held</Table.Th><Table.Th ta="right">Weight</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id} data-clickable onClick={() => navigate(`/safekeeping/${r.id}`)}>
                    <Table.Td><Text ff="monospace" size="sm" fw={600}>{r.receipt_no}</Text><Text size="xs" c="dimmed">{shortDate(r.received_at)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{r.clients?.full_name}</Text><Text size="xs" c="dimmed">{phoneDisplay(r.clients?.phone)}</Text></Table.Td>
                    <Table.Td><Text size="sm" lineClamp={2}>{r.custody_items.map((i) => `${i.description}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ")}</Text>
                      {r.sale_id && <Badge size="xs" variant="outline" color="ink">bought here</Badge>}</Table.Td>
                    <Table.Td ta="right" ff="monospace" fz="sm">{totalWeight(r).toFixed(3)} g</Table.Td>
                    <Table.Td><Badge color={r.status === "held" ? "gold" : "gray"}>{r.status === "held" ? "Held" : `Returned ${shortDate(r.returned_at)}`}</Badge></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
          <Stack gap="xs" hiddenFrom="sm">
            {rows.map((r) => (
              <Card key={r.id} padding="sm" onClick={() => navigate(`/safekeeping/${r.id}`)} style={{ cursor: "pointer" }}>
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text ff="monospace" size="sm" fw={600}>{r.receipt_no}</Text>
                    <Text size="xs" c="dimmed" truncate>{r.clients?.full_name} · {r.custody_items.map((i) => i.description).join(", ")}</Text>
                  </div>
                  <Stack gap={2} align="flex-end">
                    <Text size="sm" ff="monospace">{totalWeight(r).toFixed(3)} g</Text>
                    <Badge size="xs" color={r.status === "held" ? "gold" : "gray"}>{r.status}</Badge>
                  </Stack>
                </Group>
              </Card>
            ))}
          </Stack>
        </>
      )}
    </>
  );
}

/** Line weights are per piece (e.g. 5 coins × 10 g), matching custody_summary(). */
function totalWeight(r: Row) {
  return r.custody_items.reduce((s, i) => s + Number(i.gross_weight_g ?? 0) * i.qty, 0);
}
