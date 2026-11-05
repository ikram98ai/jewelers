import { Alert, Anchor, Badge, Button, Card, Divider, Group, Image, Modal, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconPrinter, IconShieldCheck } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ScanButton } from "@/components/ScanButton";
import { ErrorText, Loading } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { dateTime, phoneDisplay } from "@/lib/format";
import { CUSTODY_BUCKET, useSignedUrls } from "@/lib/photos";
import { unwrap, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { CustodyItem, CustodyReceipt } from "@/lib/types";

type Full = CustodyReceipt & {
  clients: { id: string; full_name: string; phone: string; address: string | null; city: string | null } | null;
  sales: { id: string; invoice_no: string } | null;
  receiver: { full_name: string } | null;
  returner: { full_name: string } | null;
  custody_items: CustodyItem[];
  custody_photos: { id: string; storage_path: string }[];
};

export default function SafekeepingDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const [releaseOpen, release] = useDisclosure(false);

  const r = useQuery({
    queryKey: ["custody", "one", id],
    queryFn: async () => unwrap(await supabase.from("custody_receipts").select(`
      *, clients(id, full_name, phone, address, city), sales(id, invoice_no),
      receiver:profiles!custody_receipts_received_by_fkey(full_name),
      returner:profiles!custody_receipts_returned_by_fkey(full_name),
      custody_items(*), custody_photos(id, storage_path)
    `).eq("id", id).single()) as unknown as Full,
  });
  const qr = useQuery({
    queryKey: ["qr", r.data?.receipt_no],
    enabled: !!r.data,
    queryFn: () => QRCode.toDataURL(r.data!.receipt_no, { margin: 0, width: 200 }),
  });
  const urls = useSignedUrls((r.data?.custody_photos ?? []).map((p) => p.storage_path), CUSTODY_BUCKET).data ?? {};

  if (r.isLoading) return <Loading />;
  if (r.error || !r.data) return <ErrorText error={r.error ?? "Receipt not found"} />;
  const d = r.data;
  const items = [...d.custody_items].sort((a, b) => a.sort_order - b.sort_order);
  const byPurity = new Map<string, number>();
  for (const i of items) if (i.gross_weight_g) byPurity.set(`${i.purity ?? ""} ${i.metal}`.trim(), (byPurity.get(`${i.purity ?? ""} ${i.metal}`.trim()) ?? 0) + Number(i.gross_weight_g) * i.qty);

  return (
    <>
      {params.get("new") && (
        <Alert color="green" icon={<IconCheck />} mb="md" className="no-print" title="Receipt issued">
          Print it and give it to the client. They must bring it back to collect their gold.
        </Alert>
      )}
      <Group justify="space-between" mb="md" className="no-print">
        <Group gap="xs"><Title order={2}>Safekeeping receipt</Title><Badge size="lg" color={d.status === "held" ? "gold" : "gray"}>{d.status === "held" ? "Held" : "Returned"}</Badge></Group>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconPrinter size={18} />} onClick={() => window.print()}>Print</Button>
          {d.status === "held" && <Button color="green" leftSection={<IconShieldCheck size={18} />} onClick={release.open}>Return to client</Button>}
        </Group>
      </Group>

      {d.status === "returned" && (
        <Alert color="gray" mb="md" className="no-print" title="Collected">
          Returned {dateTime(d.returned_at)} by {d.returner?.full_name}{d.returned_to ? ` to ${d.returned_to}` : ""}.{d.returned_note ? ` ${d.returned_note}` : ""}
        </Alert>
      )}

      <Card className="print-area" maw={760} mx="auto" padding="xl">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Title order={2} ff="heading">{settings?.shop_name}</Title>
            {settings?.address && <Text size="sm" c="dimmed">{settings.address}</Text>}
            {settings?.phone && <Text size="sm" c="dimmed">{settings.phone}</Text>}
            <Text mt="sm" fw={700} tt="uppercase" lts={1}>Safekeeping receipt · Amanat</Text>
          </div>
          <Stack gap={4} align="center">
            {qr.data && <img src={qr.data} alt={d.receipt_no} width={96} height={96} />}
            <Text ff="monospace" fw={700}>{d.receipt_no}</Text>
          </Stack>
        </Group>

        <Card withBorder={false} bg="gray.0" padding="sm" my="md">
          <Group justify="space-between" wrap="wrap">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Owner of the items</Text>
              {d.clients && <Anchor component={Link} to={`/clients/${d.clients.id}`} fw={600} c="dark">{d.clients.full_name}</Anchor>}
              <Text size="sm">{phoneDisplay(d.clients?.phone)}{d.clients?.city ? ` · ${d.clients.city}` : ""}</Text>
            </div>
            <Stack gap={0} align="flex-end">
              <Text size="sm">Received {dateTime(d.received_at)}</Text>
              <Text size="sm" c="dimmed">by {d.receiver?.full_name}</Text>
              {d.sales && <Text size="sm">Bought on <Anchor component={Link} to={`/sales/${d.sales.id}`} ff="monospace">{d.sales.invoice_no}</Anchor></Text>}
            </Stack>
          </Group>
        </Card>

        <Table verticalSpacing="xs">
          <Table.Thead><Table.Tr><Table.Th>Item</Table.Th><Table.Th>Metal</Table.Th><Table.Th ta="right">Qty</Table.Th><Table.Th ta="right">Weight each</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td><Text size="sm" fw={500}>{i.description}</Text></Table.Td>
                <Table.Td><Text size="sm">{i.purity ? `${i.purity} ${i.metal}` : i.metal}</Text></Table.Td>
                <Table.Td ta="right">{i.qty}</Table.Td>
                <Table.Td ta="right" ff="monospace" fz="sm">{i.gross_weight_g ? `${Number(i.gross_weight_g).toFixed(3)} g` : "—"}</Table.Td>
                <Table.Td ta="right" ff="monospace" fz="sm" fw={600}>{i.gross_weight_g ? `${(Number(i.gross_weight_g) * i.qty).toFixed(3)} g` : "—"}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="flex-end" gap="lg" mt="xs">
          {[...byPurity.entries()].map(([k, w]) => <Text key={k} size="sm" fw={600}>{k}: {w.toFixed(3)} g</Text>)}
        </Group>

        {d.custody_photos.length > 0 && (
          <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs" mt="md">
            {d.custody_photos.map((p) => <Image key={p.id} src={urls[p.storage_path]} radius="md" h={110} fit="cover" alt="" />)}
          </SimpleGrid>
        )}
        {d.note && <Text size="sm" mt="md"><b>Note:</b> {d.note}</Text>}

        <Divider my="lg" />
        <Text size="xs" c="dimmed">
          The items above belong to the client named here and are held by the shop for safekeeping. They will be returned only
          when this original receipt ({d.receipt_no}) is presented. Keep it safe.
        </Text>
        <SimpleGrid cols={2} mt={48}>
          <Text size="xs" ta="center" style={{ borderTop: "1px solid #999", paddingTop: 4 }}>Shop signature &amp; stamp</Text>
          <Text size="xs" ta="center" style={{ borderTop: "1px solid #999", paddingTop: 4 }}>Client signature</Text>
        </SimpleGrid>
      </Card>

      {releaseOpen && <ReleaseModal receiptId={d.id} receiptNo={d.receipt_no} clientName={d.clients?.full_name ?? ""} onClose={release.close}
        onDone={() => { queryClient.invalidateQueries({ queryKey: ["custody"] }); }} />}
    </>
  );
}

function ReleaseModal({ receiptId, receiptNo, clientName, onClose, onDone }: {
  receiptId: string; receiptNo: string; clientName: string; onClose: () => void; onDone: () => void;
}) {
  const [presented, setPresented] = useState("");
  const [to, setTo] = useState(clientName);
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("release_custody", {
      p_receipt_id: receiptId, p_presented_receipt_no: presented, p_returned_to: to || undefined, p_note: note || undefined,
    })),
    onSuccess: () => { notifications.show({ color: "green", message: `${receiptNo} returned to ${to || "the client"}` }); onDone(); onClose(); },
  });
  const matches = presented.trim().toUpperCase() === receiptNo;
  return (
    <Modal opened onClose={onClose} title="Return gold to the client">
      <Stack>
        <Text size="sm">Ask for the <b>original receipt</b>. Scan its QR code or type the number printed on it.</Text>
        <Group gap="sm" wrap="nowrap" align="flex-end">
          <TextInput flex={1} label="Receipt number on the paper" placeholder="AMN-2026-00001" value={presented}
            onChange={(e) => setPresented(e.currentTarget.value)} error={presented && !matches ? "Does not match this receipt" : undefined} />
          <ScanButton compact onScan={setPresented} />
        </Group>
        <TextInput label="Collected by" description="Name of the person taking the items" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
        <Textarea label="Note" placeholder="optional" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        {go.error && <Alert color="red">{friendlyError(go.error)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="green" disabled={!matches} loading={go.isPending} onClick={() => go.mutate()}>Confirm return</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
