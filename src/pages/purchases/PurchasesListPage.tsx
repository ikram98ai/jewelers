import { Badge, Button, Card, Group, Stack, Table, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, ErrorText, Loading, Money, PageHeader } from "@/components/ui";
import { methodLabel, shortDate } from "@/lib/format";
import { unwrap } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { MeltPile } from "./MeltPile";

type Row = {
  id: string; purchase_no: string; total: number; method: string; created_at: string;
  clients: { full_name: string } | null;
  purchase_items: { description: string; destination: string }[];
};

export default function PurchasesListPage() {
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => unwrap(await supabase.from("purchases")
      .select("id, purchase_no, total, method, created_at, clients(full_name), purchase_items(description, destination)")
      .order("created_at", { ascending: false }).limit(200)) as unknown as Row[],
  });

  return (
    <>
      <PageHeader title="Purchases" subtitle="Used jewellery, sets and old gold the shop has bought"
        actions={<Button leftSection={<IconPlus size={18} />} component={Link} to="/sell?tab=buy">Buy from client</Button>} />

      <MeltPile />

      <ErrorText error={list.error} />
      {list.isLoading ? <Loading /> : (list.data ?? []).length === 0 ? <EmptyState title="Nothing bought yet" /> : (
        <>
          <Card padding={0} visibleFrom="sm">
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Voucher</Table.Th><Table.Th>From</Table.Th><Table.Th>Items</Table.Th><Table.Th ta="right">Paid</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {list.data!.map((p) => (
                  <Table.Tr key={p.id} data-clickable onClick={() => navigate(`/purchases/${p.id}`)}>
                    <Table.Td><Text ff="monospace" size="sm" fw={600}>{p.purchase_no}</Text><Text size="xs" c="dimmed">{shortDate(p.created_at)}</Text></Table.Td>
                    <Table.Td>{p.clients?.full_name}</Table.Td>
                    <Table.Td>
                      <Group gap={4}>{p.purchase_items.map((i, k) => (
                        <Badge key={k} variant="light" color={i.destination === "stock" ? "green" : "orange"}>{i.description} → {i.destination === "stock" ? "stock" : "melt"}</Badge>
                      ))}</Group>
                    </Table.Td>
                    <Table.Td ta="right"><Money value={p.total} fw={600} /><Text size="xs" c="dimmed">{methodLabel(p.method)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
          <Stack gap="xs" hiddenFrom="sm">
            {list.data!.map((p) => (
              <Card key={p.id} padding="sm" onClick={() => navigate(`/purchases/${p.id}`)} style={{ cursor: "pointer" }}>
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text ff="monospace" size="sm" fw={600}>{p.purchase_no}</Text>
                    <Text size="xs" c="dimmed" truncate>{p.clients?.full_name} · {p.purchase_items.map((i) => i.description).join(", ")}</Text>
                  </div>
                  <Money value={p.total} fw={700} size="sm" />
                </Group>
              </Card>
            ))}
          </Stack>
        </>
      )}
    </>
  );
}
