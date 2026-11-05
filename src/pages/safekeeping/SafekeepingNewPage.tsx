import {
  ActionIcon, Alert, Button, Card, CloseButton, Grid, Group, Image, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClientSelect } from "@/components/ClientSelect";
import { PageHeader } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { METALS, num, PURITIES } from "@/lib/format";
import { CUSTODY_BUCKET, uploadPhoto } from "@/lib/photos";
import { unwrap } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Client } from "@/lib/types";

interface Line { key: string; description: string; metal: string; purity: string | null; qty: number | string; weight: number | string; item_id: string | null }
const newLine = (): Line => ({ key: crypto.randomUUID(), description: "", metal: "gold", purity: "24K", qty: 1, weight: "", item_id: null });

export default function SafekeepingNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const saleId = params.get("sale");
  const [client, setClient] = useState<Client | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // From a sale: the client and the pieces they bought are filled in.
  const sale = useQuery({
    queryKey: ["custody-from-sale", saleId],
    enabled: !!saleId,
    queryFn: async () => unwrap(await supabase.from("sales")
      .select("id, invoice_no, clients(*), sale_items(item_id, item_name, metal, purity, qty, items(gross_weight_g))")
      .eq("id", saleId!).single()) as unknown as {
        invoice_no: string; clients: Client | null;
        sale_items: { item_id: string; item_name: string; metal: string; purity: string | null; qty: number; items: { gross_weight_g: number | null } | null }[];
      },
  });
  useEffect(() => {
    if (!sale.data) return;
    setClient(sale.data.clients);
    setLines(sale.data.sale_items.map((si) => ({
      key: crypto.randomUUID(), description: si.item_name, metal: si.metal, purity: si.purity, qty: si.qty,
      weight: si.items?.gross_weight_g ?? "", item_id: si.item_id,
    })));
    setNote(`Bought on ${sale.data.invoice_no}; client asked the shop to keep it`);
  }, [sale.data]);

  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const problems = [
    !client && "Choose the client.",
    lines.some((l) => !l.description.trim()) && "Describe every item.",
    lines.some((l) => l.metal !== "other" && !(num(l.weight)! > 0)) && "Enter the weight of each gold/silver item.",
  ].filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: async () => {
      const res = unwrap(await supabase.rpc("create_custody", {
        p_client_id: client!.id,
        p_sale_id: saleId ?? undefined,
        p_note: note || undefined,
        p_items: lines.map((l) => ({
          description: l.description.trim(), metal: l.metal, purity: l.metal === "other" ? null : l.purity,
          qty: Number(l.qty) || 1, gross_weight_g: num(l.weight), item_id: l.item_id,
        })),
      })) as unknown as { receipt_id: string; receipt_no: string };
      for (const f of photos) {
        try {
          const path = await uploadPhoto(CUSTODY_BUCKET, res.receipt_id, f);
          unwrap(await supabase.from("custody_photos").insert({ receipt_id: res.receipt_id, storage_path: path }));
        } catch (e) {
          notifications.show({ color: "orange", message: `Receipt saved, but a photo failed: ${friendlyError(e)}` });
        }
      }
      return res;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["custody"] });
      navigate(`/safekeeping/${r.receipt_id}?new=1`, { replace: true });
    },
  });

  return (
    <>
      <PageHeader title="New safekeeping receipt" subtitle={saleId ? `For gold bought on ${sale.data?.invoice_no ?? "…"}` : "Gold the client is leaving with the shop"} />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card><ClientSelect value={client} onChange={setClient} /></Card>
            <Card>
              <Group justify="space-between" mb="sm">
                <Title order={4}>What is being kept</Title>
                <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, newLine()])}>Add item</Button>
              </Group>
              <Stack gap="sm">
                {lines.map((l, i) => (
                  <Card key={l.key} padding="sm" bg="gray.0" withBorder={false}>
                    <Group gap="xs" align="flex-end" wrap="nowrap">
                      <TextInput flex={1} size="sm" label="Description" placeholder="e.g. Gold biscuit 1 tola, bridal set…" value={l.description}
                        onChange={(e) => set(i, { description: e.currentTarget.value })} />
                      {lines.length > 1 && <ActionIcon variant="subtle" color="red" size="lg" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove"><IconTrash size={18} /></ActionIcon>}
                    </Group>
                    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mt="xs">
                      <Select size="sm" label="Metal" data={METALS.map((m) => ({ value: m.value, label: m.label }))} value={l.metal}
                        onChange={(m) => set(i, { metal: m ?? "gold", purity: PURITIES[m ?? "gold"]?.[0] ?? null })} />
                      {l.metal !== "other" ? <Select size="sm" label="Purity" data={PURITIES[l.metal] ?? []} value={l.purity} onChange={(p) => set(i, { purity: p })} /> : <div />}
                      <NumberInput size="sm" label="How many" min={1} allowDecimal={false} value={l.qty} onChange={(v) => set(i, { qty: v })} />
                      <NumberInput size="sm" label="Weight each (g)" decimalScale={3} min={0} value={l.weight} onChange={(v) => set(i, { weight: v })} />
                    </SimpleGrid>
                  </Card>
                ))}
              </Stack>
            </Card>
            <Card>
              <Text size="sm" fw={500} mb={6}>Photos of the items (recommended)</Text>
              <Group gap="sm">
                {previews.map((u, i) => (
                  <div key={u} style={{ position: "relative" }}>
                    <Image src={u} w={72} h={72} radius="md" fit="cover" alt="" />
                    <CloseButton size="sm" style={{ position: "absolute", top: 2, right: 2, background: "white" }} onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label="Remove photo" />
                  </div>
                ))}
                {photos.length < 6 && <Button variant="light" color="gold" h={72} leftSection={<IconCamera size={20} />} onClick={() => fileRef.current?.click()}>Add photo</Button>}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
                  onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) setPhotos((p) => [...p, f]); e.currentTarget.value = ""; }} />
              </Group>
              <Textarea mt="md" label="Note" placeholder="e.g. To collect after the wedding" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card style={{ position: "sticky", top: 80 }}>
            <Stack>
              <Text size="sm">The client gets a numbered receipt. The gold is handed back <b>only</b> when that receipt is shown again.</Text>
              <Text size="sm" c="dimmed">Total weight: {lines.reduce((s, l) => s + (num(l.weight) ?? 0) * (Number(l.qty) || 1), 0).toFixed(3)} g</Text>
              {problems.length > 0 && <Alert color="orange" p="xs">{problems.map((p) => <Text key={p} size="xs">{p}</Text>)}</Alert>}
              {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
              <Button size="lg" color="gold" disabled={problems.length > 0} loading={save.isPending} onClick={() => save.mutate()}>Issue receipt</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}
