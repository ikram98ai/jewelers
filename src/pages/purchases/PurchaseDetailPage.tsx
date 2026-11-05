import { Alert, Anchor, Badge, Button, Card, Divider, Group, SimpleGrid, Table, Text, Title } from "@mantine/core";
import { IconCheck, IconPrinter } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ErrorText, Loading, Money } from "@/components/ui";
import { dateTime, methodLabel, money, phoneDisplay } from "@/lib/format";
import { unwrap, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Purchase, PurchaseItem } from "@/lib/types";

type Full = Purchase & {
  clients: { id: string; full_name: string; phone: string; city: string | null } | null;
  profiles: { full_name: string } | null;
  purchase_items: (PurchaseItem & { items: { id: string; tag: string } | null })[];
};

export default function PurchaseDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { settings } = useSettings();
  const q = useQuery({
    queryKey: ["purchases", id],
    queryFn: async () => unwrap(await supabase.from("purchases")
      .select("*, clients(id, full_name, phone, city), profiles(full_name), purchase_items(*, items(id, tag))").eq("id", id).single()) as unknown as Full,
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorText error={q.error ?? "Not found"} />;
  const p = q.data;
  const lines = [...p.purchase_items].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <>
      {params.get("new") && (
        <Alert color="green" icon={<IconCheck />} mb="md" className="no-print" title="Purchase saved">
          Pieces put into stock have new tags: print their labels from each item.
        </Alert>
      )}
      <Group justify="space-between" mb="md" className="no-print">
        <Title order={2}>Purchase voucher</Title>
        <Button variant="default" leftSection={<IconPrinter size={18} />} onClick={() => window.print()}>Print</Button>
      </Group>
      <Card className="print-area" maw={820} mx="auto" padding="xl">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2} ff="heading">{settings?.shop_name}</Title>
            <Text size="sm" c="dimmed">{settings?.address}</Text>
            <Text mt="sm" fw={700} tt="uppercase" lts={1}>Purchase voucher</Text>
          </div>
          <div style={{ textAlign: "right" }}>
            <Text ff="monospace" fw={700} fz="lg">{p.purchase_no}</Text>
            <Text size="sm" c="dimmed">{dateTime(p.created_at)}</Text>
            <Text size="sm" c="dimmed">Bought by {p.profiles?.full_name}</Text>
          </div>
        </Group>
        <Card withBorder={false} bg="gray.0" padding="sm" my="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Seller</Text>
          {p.clients && <Anchor component={Link} to={`/clients/${p.clients.id}`} fw={600} c="dark">{p.clients.full_name}</Anchor>}
          <Text size="sm">{phoneDisplay(p.clients?.phone)}{p.clients?.city ? ` · ${p.clients.city}` : ""}{p.seller_id_note ? ` · ID: ${p.seller_id_note}` : ""}</Text>
        </Card>
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Piece</Table.Th><Table.Th ta="right">Weight</Table.Th><Table.Th ta="right">Rate / deduction</Table.Th><Table.Th ta="right">Value</Table.Th><Table.Th>Goes to</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td><Text size="sm" fw={500}>{l.description}</Text><Text size="xs" c="dimmed">{l.purity ? `${l.purity} ${l.metal}` : l.metal}</Text></Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm">{l.gross_weight_g ? `${Number(l.gross_weight_g).toFixed(3)} g` : "—"}{Number(l.stone_weight_g) ? <Text size="xs" c="dimmed">stones {Number(l.stone_weight_g).toFixed(3)} g</Text> : null}</Table.Td>
                  <Table.Td ta="right" fz="sm">{l.rate_per_g ? `${money(l.rate_per_g)}/g${Number(l.deduction_pct) ? ` −${l.deduction_pct}%` : ""}` : "agreed"}</Table.Td>
                  <Table.Td ta="right"><Money value={l.value} fw={600} size="sm" /></Table.Td>
                  <Table.Td>{l.destination === "stock"
                    ? (l.items ? <Anchor component={Link} to={`/stock/${l.items.id}`} ff="monospace" size="sm">{l.items.tag}</Anchor> : <Badge color="green">stock</Badge>)
                    : <Badge color="orange">melt</Badge>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Group justify="flex-end" mt="md" gap="xl">
          <Text size="sm" c="dimmed">Paid by {methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ""}</Text>
          <Group gap="xs"><Text fw={600}>Total paid</Text><Money value={p.total} fw={700} size="lg" /></Group>
        </Group>
        {p.note && <Text size="sm" mt="sm"><b>Note:</b> {p.note}</Text>}
        <Divider my="lg" />
        <Text size="xs" c="dimmed">The seller confirms they own the items above and has received the full amount.</Text>
        <SimpleGrid cols={2} mt={48}>
          <Text size="xs" ta="center" style={{ borderTop: "1px solid #999", paddingTop: 4 }}>Shop signature</Text>
          <Text size="xs" ta="center" style={{ borderTop: "1px solid #999", paddingTop: 4 }}>Seller signature</Text>
        </SimpleGrid>
      </Card>
    </>
  );
}
