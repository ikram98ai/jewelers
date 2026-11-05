import { Badge, Card, Code, Group, Pagination, Select, Stack, Table, Text } from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorText, Loading, PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { AuditEntry } from "@/lib/types";

const PAGE = 50;
const TABLES = ["items", "item_costs", "sales", "payments", "clients", "metal_rates", "profiles", "employee_hr", "salary_payments", "shop_settings", "categories", "admin_users"];
const HIDDEN = new Set(["updated_at", "created_at"]);

type Row = AuditEntry & { profiles: { full_name: string } | null };

export default function AuditPage() {
  const [table, setTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["audit", table, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from("audit_log").select("*, profiles(full_name)", { count: "exact" }).order("at", { ascending: false });
      if (table) q = q.eq("table_name", table);
      const { data, error, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as Row[], count: count ?? 0 };
    },
  });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to stock, money, clients and staff: who, when and what." />
      <Group mb="md">
        <Select placeholder="All tables" clearable allowDeselect data={TABLES} value={table} onChange={(t) => { setTable(t); setPage(1); }} w={{ base: "100%", xs: 220 }} />
      </Group>
      <ErrorText error={query.error} />
      {query.isLoading ? <Loading /> : (query.data?.rows.length ?? 0) === 0 ? <EmptyState title="No entries" /> : (
        <>
          <Card padding={0} visibleFrom="sm">
            <Table verticalSpacing="sm" horizontalSpacing="md">
              <Table.Tbody>
                {query.data!.rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td w={180} style={{ verticalAlign: "top" }}><Who row={r} /></Table.Td>
                    <Table.Td w={160} style={{ verticalAlign: "top" }}><What row={r} /></Table.Td>
                    <Table.Td><Changes row={r} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
          {/* Phones: one stacked card per entry instead of three fixed-width columns. */}
          <Stack gap="xs" hiddenFrom="sm">
            {query.data!.rows.map((r) => (
              <Card key={r.id} padding="sm">
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs" mb={6}>
                  <Who row={r} />
                  <What row={r} />
                </Group>
                <Changes row={r} />
              </Card>
            ))}
          </Stack>
        </>
      )}
      {(query.data?.count ?? 0) > PAGE && (
        <Group justify="center" mt="lg"><Pagination total={Math.ceil(query.data!.count / PAGE)} value={page} onChange={setPage} /></Group>
      )}
    </>
  );
}

function Who({ row }: { row: Row }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="sm" fw={500}>{row.profiles?.full_name ?? "System"}</Text>
      <Text size="xs" c="dimmed">{dateTime(row.at)}</Text>
    </div>
  );
}

function What({ row }: { row: Row }) {
  return <Group gap={6} wrap="nowrap"><Badge color={row.action === "insert" ? "green" : "blue"}>{row.action}</Badge><Text size="sm">{row.table_name}</Text></Group>;
}

function Changes({ row }: { row: Row }) {
  const next = (row.new_data ?? {}) as Record<string, unknown>;
  const prev = (row.old_data ?? {}) as Record<string, unknown>;
  const label = (next.tag ?? next.invoice_no ?? next.full_name ?? next.name ?? next.username ?? "") as string;
  const keys = row.action === "update" ? Object.keys(prev).filter((k) => !HIDDEN.has(k)) : [];
  return (
    <Stack gap={4} miw={0} style={{ overflowWrap: "anywhere" }}>
      {label && <Text size="sm" fw={500}>{label}</Text>}
      {keys.map((k) => (
        <Text key={k} size="xs">
          <Text span c="dimmed">{k}: </Text>
          <Code>{fmt(prev[k])}</Code> → <Code>{fmt(next[k])}</Code>
        </Text>
      ))}
      {row.table_name === "admin_users" && <Text size="xs" c="dimmed">{fmt(next)}</Text>}
    </Stack>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
