import { Button, Card, Group, Pagination, SegmentedControl, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconDownload, IconReceipt } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, ErrorText, Loading, Money, PageHeader, StatusBadge } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useIsMobile } from "@/lib/useIsMobile";

const PAGE = 50;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Row = {
  id: string; invoice_no: string; created_at: string; total: number; discount_total: number; status: string;
  clients: { full_name: string } | null; seller: { full_name: string } | null; payments: { amount: number }[];
};

export default function SalesListPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [status, setStatus] = useState("completed");
  const [page, setPage] = useState(1);
  const isMobile = useIsMobile();

  const query = useQuery({
    queryKey: ["sales", { from, to, status, page }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from("sales")
        .select("id, invoice_no, created_at, total, discount_total, status, clients(full_name), seller:profiles!sales_sold_by_fkey(full_name), payments(amount)", { count: "exact" })
        // Local midnight → UTC instant, so a 2 a.m. sale lands on the right day.
        .gte("created_at", new Date(`${from}T00:00:00`).toISOString())
        .lt("created_at", new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString())
        .order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status);
      const { data, error, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as Row[], count: count ?? 0 };
    },
  });

  const rows = query.data?.rows ?? [];
  const paidOf = (r: Row) => r.payments.reduce((s, p) => s + Number(p.amount), 0);
  const pageTotal = rows.filter((r) => r.status === "completed").reduce((s, r) => s + Number(r.total), 0);

  const exportCsv = () => downloadCsv(`sales-${from}-to-${to}`,
    ["Invoice", "Date", "Client", "Sold by", "Total", "Discount", "Paid", "Balance", "Status"],
    rows.map((r) => [r.invoice_no, r.created_at, r.clients?.full_name ?? "Walk-in", r.seller?.full_name, r.total, r.discount_total,
      paidOf(r), r.status === "void" ? 0 : Number(r.total) - paidOf(r), r.status]));

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle={`${query.data?.count ?? 0} invoices`}
        actions={
          <>
            <Button variant="default" leftSection={<IconDownload size={18} />} onClick={exportCsv} disabled={!rows.length}>CSV</Button>
            <Button color="gold" leftSection={<IconReceipt size={18} />} component={Link} to="/sell">New sale</Button>
          </>
        }
      />
      <Card mb="md" padding="md">
        <Group gap="sm" wrap="wrap" align="flex-end">
          <TextInput type="date" label="From" value={from} onChange={(e) => { setFrom(e.currentTarget.value); setPage(1); }} size="sm" flex={{ base: "1 1 130px", sm: "0 0 auto" }} />
          <TextInput type="date" label="To" value={to} onChange={(e) => { setTo(e.currentTarget.value); setPage(1); }} size="sm" flex={{ base: "1 1 130px", sm: "0 0 auto" }} />
          <SegmentedControl value={status} onChange={(v) => { setStatus(v); setPage(1); }} w={{ base: "100%", sm: "auto" }}
            data={[{ value: "completed", label: "Completed" }, { value: "void", label: "Void" }, { value: "all", label: "All" }]} />
          <Text size="sm" c="dimmed" ml={{ base: 0, sm: "auto" }}>This page: <Money value={pageTotal} fw={600} /></Text>
        </Group>
      </Card>

      <ErrorText error={query.error} />
      {query.isLoading ? <Loading /> : rows.length === 0 ? <EmptyState title="No sales in this period" /> : (
        <>
          <Card padding={0} visibleFrom="sm">
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Invoice</Table.Th><Table.Th>Client</Table.Th><Table.Th>Sold by</Table.Th>
                  <Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Balance</Table.Th><Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => {
                  const bal = r.status === "void" ? 0 : Number(r.total) - paidOf(r);
                  return (
                    <Table.Tr key={r.id} data-clickable onClick={() => navigate(`/sales/${r.id}`)}>
                      <Table.Td><Text ff="monospace" size="sm" fw={600}>{r.invoice_no}</Text><Text size="xs" c="dimmed">{dateTime(r.created_at)}</Text></Table.Td>
                      <Table.Td>{r.clients?.full_name ?? <Text span c="dimmed" size="sm">Walk-in</Text>}</Table.Td>
                      <Table.Td><Text size="sm">{r.seller?.full_name}</Text></Table.Td>
                      <Table.Td ta="right"><Money value={r.total} fw={600} /></Table.Td>
                      <Table.Td ta="right">{bal > 0 ? <Money value={bal} c="orange.8" /> : <Text size="sm" c="dimmed">—</Text>}</Table.Td>
                      <Table.Td><StatusBadge status={r.status} /></Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Card>
          <Stack gap="xs" hiddenFrom="sm">
            {rows.map((r) => {
              const bal = r.status === "void" ? 0 : Number(r.total) - paidOf(r);
              return (
                <Card key={r.id} padding="sm" onClick={() => navigate(`/sales/${r.id}`)} style={{ cursor: "pointer" }}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <div style={{ minWidth: 0 }}>
                      <Text ff="monospace" size="sm" fw={600}>{r.invoice_no}</Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>{r.clients?.full_name ?? "Walk-in"} · {dateTime(r.created_at)}</Text>
                    </div>
                    <Stack gap={0} align="flex-end">
                      <Money value={r.total} fw={700} size="sm" />
                      {r.status === "void" ? <StatusBadge status="void" size="xs" /> : bal > 0 && <Text size="xs" c="orange.8">due {Math.round(bal).toLocaleString()}</Text>}
                    </Stack>
                  </Group>
                </Card>
              );
            })}
          </Stack>
          {(query.data?.count ?? 0) > PAGE && (
            <Group justify="center" mt="lg"><Pagination total={Math.ceil((query.data?.count ?? 0) / PAGE)} value={page} onChange={setPage} siblings={isMobile ? 0 : 1} /></Group>
          )}
        </>
      )}
    </>
  );
}
