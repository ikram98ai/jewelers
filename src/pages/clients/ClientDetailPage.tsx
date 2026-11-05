import { Alert, Anchor, Badge, Button, Card, Grid, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconArchive, IconBrandWhatsapp, IconEdit, IconPhone, IconReceipt } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorText, KeyValue, Loading, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { dateTime, methodLabel, phoneDisplay, shortDate, whatsappLink } from "@/lib/format";
import { unwrap, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Client, ClientBalance } from "@/lib/types";
import { ClientFormModal } from "./ClientFormModal";

type SaleRow = { id: string; invoice_no: string; created_at: string; total: number; status: string; sale_items: { item_name: string }[]; payments: { amount: number }[] };

export default function ClientDetailPage() {
  const { id = "" } = useParams();
  const { isAdmin } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, edit] = useDisclosure(false);

  const client = useQuery({
    queryKey: ["client", id],
    queryFn: async () => unwrap(await supabase.from("clients").select("*").eq("id", id).single()) as Client,
  });
  const balance = useQuery({
    queryKey: ["client", id, "balance"],
    queryFn: async () => unwrap(await supabase.from("client_balances").select("*").eq("client_id", id).single()) as ClientBalance,
  });
  const sales = useQuery({
    queryKey: ["client", id, "sales"],
    queryFn: async () => unwrap(await supabase.from("sales")
      .select("id, invoice_no, created_at, total, status, sale_items(item_name), payments(amount)")
      .eq("client_id", id).order("created_at", { ascending: false })) as unknown as SaleRow[],
  });
  const payments = useQuery({
    queryKey: ["client", id, "payments"],
    queryFn: async () => unwrap(await supabase.from("payments").select("id, method, amount, created_at, sales(invoice_no, id)")
      .eq("client_id", id).order("created_at", { ascending: false }).limit(50)) as unknown as
      { id: string; method: string; amount: number; created_at: string; sales: { invoice_no: string; id: string } }[],
  });

  const archive = useMutation({
    mutationFn: async (archived: boolean) => unwrap(await supabase.from("clients").update({ archived }).eq("id", id)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["client", id] }); queryClient.invalidateQueries({ queryKey: ["clients"] }); },
    onError: (e) => notifications.show({ color: "red", message: friendlyError(e) }),
  });

  if (client.isLoading) return <Loading />;
  if (client.error || !client.data) return <ErrorText error={client.error ?? "Client not found"} />;
  const c = client.data;
  const due = Number(balance.data?.balance ?? 0);
  const openSales = (sales.data ?? []).filter((s) => s.status === "completed" && Number(s.total) - s.payments.reduce((t, p) => t + Number(p.amount), 0) > 0);

  return (
    <>
      <PageHeader
        title={c.full_name}
        subtitle={<>{phoneDisplay(c.phone)}{c.city ? ` · ${c.city}` : ""}{c.archived && <Badge ml="xs" color="gray">Archived</Badge>}</>}
        actions={
          <>
            <Button variant="default" component="a" href={`tel:${c.phone}`} leftSection={<IconPhone size={18} />}>Call</Button>
            <Button variant="default" component="a" href={whatsappLink(c.phone, settings?.phone_country_code ?? "92")} target="_blank" rel="noopener noreferrer"
              leftSection={<IconBrandWhatsapp size={18} />} color="green">WhatsApp</Button>
            <Button variant="default" leftSection={<IconEdit size={18} />} onClick={edit.open}>Edit</Button>
            <Button color="gold" leftSection={<IconReceipt size={18} />} onClick={() => navigate("/sell")}>New sale</Button>
          </>
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 3 }} mb="lg" spacing={{ base: "xs", sm: "md" }}>
        <StatCard label="Balance due" value={<Money value={due} fw={700} c={due > 0 ? "orange.8" : undefined} />} />
        <StatCard label="Total purchases" value={<Money value={balance.data?.total_purchases} fw={700} />} />
        <StatCard label="Last purchase" value={shortDate(balance.data?.last_purchase_at)} />
      </SimpleGrid>

      {openSales.length > 0 && (
        <Alert color="orange" mb="lg" title="Unpaid invoices">
          <Group gap="xs">
            {openSales.map((s) => <Button key={s.id} size="xs" variant="white" color="orange" component={Link} to={`/sales/${s.id}`}>{s.invoice_no} · take payment</Button>)}
          </Group>
        </Alert>
      )}

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card>
            <Title order={5} mb="xs">Details</Title>
            <KeyValue label="Phone">{phoneDisplay(c.phone)}</KeyValue>
            {c.alt_phone && <KeyValue label="Other phone">{phoneDisplay(c.alt_phone)}</KeyValue>}
            <KeyValue label="Address">{[c.address, c.city].filter(Boolean).join(", ") || "—"}</KeyValue>
            <KeyValue label="Birthday">{shortDate(c.birthday)}</KeyValue>
            <KeyValue label="Anniversary">{shortDate(c.anniversary)}</KeyValue>
            <KeyValue label="Client since">{shortDate(c.created_at)}</KeyValue>
            {c.notes && <Text size="sm" mt="sm" c="dimmed">{c.notes}</Text>}
            {isAdmin && (
              <Button mt="md" variant="subtle" color="gray" size="xs" leftSection={<IconArchive size={14} />}
                onClick={() => modals.openConfirmModal({
                  title: c.archived ? "Unarchive client?" : "Archive client?",
                  children: <Text size="sm">{c.archived ? "They will appear in searches again." : "They will be hidden from searches. History is kept."}</Text>,
                  labels: { confirm: c.archived ? "Unarchive" : "Archive", cancel: "Cancel" },
                  onConfirm: () => archive.mutate(!c.archived),
                })}>
                {c.archived ? "Unarchive" : "Archive client"}
              </Button>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card>
              <Title order={5} mb="xs">Purchases</Title>
              {(sales.data ?? []).length === 0 ? <Text c="dimmed" size="sm">No purchases yet.</Text> : (
                <Table verticalSpacing={6}>
                  <Table.Tbody>
                    {sales.data!.map((s) => (
                      <Table.Tr key={s.id} data-clickable onClick={() => navigate(`/sales/${s.id}`)}>
                        <Table.Td><Text ff="monospace" size="sm" fw={600}>{s.invoice_no}</Text><Text size="xs" c="dimmed">{shortDate(s.created_at)}</Text></Table.Td>
                        <Table.Td visibleFrom="sm"><Text size="sm" lineClamp={1}>{s.sale_items.map((i) => i.item_name).join(", ")}</Text></Table.Td>
                        <Table.Td ta="right"><Money value={s.total} fw={600} /></Table.Td>
                        <Table.Td><StatusBadge status={s.status} /></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>
            <Card>
              <Title order={5} mb="xs">Payments</Title>
              {(payments.data ?? []).length === 0 ? <Text c="dimmed" size="sm">No payments yet.</Text> : (
                <Table verticalSpacing={6}>
                  <Table.Tbody>
                    {payments.data!.map((p) => (
                      <Table.Tr key={p.id}>
                        <Table.Td><Text size="sm">{methodLabel(p.method)}</Text><Text size="xs" c="dimmed">{dateTime(p.created_at)}</Text></Table.Td>
                        <Table.Td><Anchor component={Link} to={`/sales/${p.sales.id}`} ff="monospace" size="sm">{p.sales.invoice_no}</Anchor></Table.Td>
                        <Table.Td ta="right"><Money value={p.amount} /></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      {editOpen && <ClientFormModal opened onClose={edit.close} client={c} />}
    </>
  );
}
