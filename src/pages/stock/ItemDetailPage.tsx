import {
  ActionIcon, Alert, Anchor, Badge, Button, Card, Center, Grid, Group, Image, Menu, Modal, NumberInput, Select,
  SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustments, IconArchive, IconCamera, IconDots, IconEdit, IconPrinter, IconReceipt, IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ItemThumb } from "@/components/ItemThumb";
import { SetContents } from "@/components/SetContents";
import { ErrorText, KeyValue, Loading, Money, PageHeader, PurityBadge, StatusBadge, Weight } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { dateTime, METALS, PURITIES, num, shortDate } from "@/lib/format";
import { uploadItemPhoto, useSignedUrls } from "@/lib/photos";
import { useCategories, unwrap } from "@/lib/queries";
import { PHOTO_BUCKET, supabase } from "@/lib/supabase";
import type { Item, ItemCost } from "@/lib/types";

type FullItem = Item & {
  suggested_price: number | null;
  categories: { name: string } | null;
  item_photos: { id: string; storage_path: string; sort_order: number }[];
};
type Move = { id: number; type: string; qty: number; reason: string | null; created_at: string; sale_id: string | null; profiles: { full_name: string } | null };

const MOVE_LABEL: Record<string, string> = {
  receive: "Received", sale: "Sold", void_return: "Returned (void)", adjust: "Adjusted", write_off: "Written off", restore: "Restored",
};

export default function ItemDetailPage() {
  const { id = "" } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editOpen, edit] = useDisclosure(false);
  const [adjustOpen, adjust] = useDisclosure(false);
  const [costOpen, cost] = useDisclosure(false);

  const item = useQuery({
    queryKey: ["item", id],
    queryFn: async () => unwrap(await supabase.from("items")
      .select("*, suggested_price, categories(name), item_photos(id, storage_path, sort_order)")
      .eq("id", id).single()) as unknown as FullItem,
  });
  const moves = useQuery({
    queryKey: ["item-moves", id],
    queryFn: async () => unwrap(await supabase.from("stock_moves")
      .select("id, type, qty, reason, created_at, sale_id, profiles!stock_moves_created_by_fkey(full_name)")
      .eq("item_id", id).order("created_at", { ascending: false }).limit(50)) as unknown as Move[],
  });
  const sales = useQuery({
    queryKey: ["item-sales", id],
    queryFn: async () => unwrap(await supabase.from("sale_items")
      .select("final_price, qty, sales(id, invoice_no, status, created_at)")
      .eq("item_id", id).order("created_at", { ascending: false })) as unknown as
      { final_price: number; qty: number; sales: { id: string; invoice_no: string; status: string; created_at: string } }[],
  });
  const margin = useQuery({
    queryKey: ["item-margin", id],
    enabled: isAdmin,
    queryFn: async () => unwrap(await supabase.rpc("item_margin", { p_item_id: id })) as unknown as { cost: number | null; margin: number | null },
  });
  const costRow = useQuery({
    queryKey: ["item-cost", id],
    enabled: isAdmin,
    queryFn: async () => unwrap(await supabase.from("item_costs").select("*").eq("item_id", id).maybeSingle()) as ItemCost | null,
  });

  const photos = [...(item.data?.item_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const urls = useSignedUrls(photos.map((p) => p.storage_path)).data ?? {};

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["item", id] });
    queryClient.invalidateQueries({ queryKey: ["item-moves", id] });
    queryClient.invalidateQueries({ queryKey: ["item-margin", id] });
    queryClient.invalidateQueries({ queryKey: ["item-cost", id] });
    queryClient.invalidateQueries({ queryKey: ["items"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const deletePhoto = useMutation({
    mutationFn: async (p: { id: string; storage_path: string }) => {
      unwrap(await supabase.from("item_photos").delete().eq("id", p.id));
      await supabase.storage.from(PHOTO_BUCKET).remove([p.storage_path]);
    },
    onSuccess: refresh,
    onError: (e) => notifications.show({ color: "red", message: friendlyError(e) }),
  });

  if (item.isLoading) return <Loading />;
  if (item.error || !item.data) return <ErrorText error={item.error ?? "Item not found"} />;
  const it = item.data;

  return (
    <>
      <PageHeader
        title={it.name}
        subtitle={<Group gap="xs" component="span"><Text span ff="monospace">{it.tag}</Text>{it.legacy_tag && <Text span c="dimmed">· old tag {it.legacy_tag}</Text>}<Text span c="dimmed">· {it.categories?.name}</Text></Group>}
        actions={
          <>
            {it.status === "in_stock" && it.qty_on_hand > 0 && (
              <Button color="gold" leftSection={<IconReceipt size={18} />} onClick={() => navigate(`/sell?item=${it.id}`)}>Sell</Button>
            )}
            <Button variant="default" leftSection={<IconPrinter size={18} />} onClick={() => navigate(`/stock/labels?ids=${it.id}`)}>Label</Button>
            {isAdmin && (
              <Menu position="bottom-end">
                <Menu.Target><ActionIcon variant="default" size="input-md" aria-label="More actions"><IconDots size={20} /></ActionIcon></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconEdit size={16} />} onClick={edit.open}>Edit details</Menu.Item>
                  <Menu.Item leftSection={<IconAdjustments size={16} />} onClick={adjust.open}>Adjust / write off</Menu.Item>
                  <Menu.Item leftSection={<IconArchive size={16} />} onClick={cost.open}>Cost & supplier</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card>
            {photos.length === 0 ? <Center><ItemThumb size={240} /></Center> : (
              <SimpleGrid cols={photos.length === 1 ? 1 : 2} spacing="xs">
                {photos.map((p) => (
                  <div key={p.id} style={{ position: "relative" }}>
                    <Image src={urls[p.storage_path]} radius="md" fit="cover" h={photos.length === 1 ? 300 : 150} alt={it.name} />
                    {isAdmin && (
                      <ActionIcon size="sm" color="red" variant="white" style={{ position: "absolute", top: 6, right: 6 }}
                        onClick={() => deletePhoto.mutate(p)} aria-label="Delete photo"><IconTrash size={14} /></ActionIcon>
                    )}
                  </div>
                ))}
              </SimpleGrid>
            )}
            {photos.length < 4 && (
              <Button mt="sm" fullWidth variant="light" color="gold" leftSection={<IconCamera size={18} />} loading={uploading}
                onClick={() => fileRef.current?.click()}>Add photo</Button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!f) return;
              setUploading(true);
              try { await uploadItemPhoto(it.id, f, photos.length); refresh(); }
              catch (err) { notifications.show({ color: "red", message: friendlyError(err) }); }
              finally { setUploading(false); }
            }} />
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack>
            <Card>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="xs" tt="uppercase" fw={600} c="dimmed">Price today</Text>
                  <Money value={it.suggested_price} fw={700} size="xl" />
                  {it.suggested_price === null && <Text size="xs" c="orange">Set today's rate for {it.metal} {it.purity}</Text>}
                </div>
                <Group gap="xs">
                  <StatusBadge status={it.status} size="lg" />
                  {it.archived && <Badge color="gray" size="lg">Archived</Badge>}
                </Group>
              </Group>
              {isAdmin && margin.data && (
                <Group mt="md" gap="xl" style={{ rowGap: "var(--mantine-spacing-sm)" }}>
                  <div><Text size="xs" c="dimmed">Cost</Text><Money value={margin.data.cost} fw={600} /></div>
                  <div><Text size="xs" c="dimmed">Margin at today's price</Text><Money value={margin.data.margin} fw={600} c={margin.data.margin !== null && margin.data.margin < 0 ? "red" : "green.8"} /></div>
                  {costRow.data?.supplier && <div><Text size="xs" c="dimmed">Supplier</Text><Text size="sm">{costRow.data.supplier}</Text></div>}
                </Group>
              )}
            </Card>

            <Card>
              <Title order={5} mb="xs">Details</Title>
              <KeyValue label="Metal"><PurityBadge metal={it.metal} purity={it.purity} /></KeyValue>
              {it.tracking === "piece" ? (
                <>
                  <KeyValue label="Gross weight"><Weight grams={it.gross_weight_g} size="sm" /></KeyValue>
                  <KeyValue label="Stone weight"><Weight grams={it.stone_weight_g} size="sm" /></KeyValue>
                  <KeyValue label="Net weight"><Weight grams={it.net_weight_g} size="sm" /></KeyValue>
                </>
              ) : (
                <KeyValue label="In stock">{`${it.qty_on_hand} pcs${it.low_stock_at !== null ? ` (warn at ${it.low_stock_at})` : ""}`}</KeyValue>
              )}
              {it.fixed_price !== null ? (
                <KeyValue label="Fixed price"><Money value={it.fixed_price} /></KeyValue>
              ) : (
                <>
                  <KeyValue label="Making charge"><Group gap={4}><Money value={it.making_charge} />{it.making_type === "per_gram" ? <Text size="sm" c="dimmed">/ g</Text> : null}</Group></KeyValue>
                  <KeyValue label="Stones / other"><Money value={it.stone_charge} /></KeyValue>
                </>
              )}
              <KeyValue label="Received">{shortDate(it.created_at)}</KeyValue>
              {it.description && <Text size="sm" mt="sm" c="dimmed">{it.description}</Text>}
            </Card>

            <SetContents itemId={it.id} setGrossWeight={it.gross_weight_g} alwaysShow={it.categories?.name === "Set"} />

            {(sales.data?.length ?? 0) > 0 && (
              <Card>
                <Title order={5} mb="xs">Sales</Title>
                {sales.data!.map((s) => (
                  <Group key={s.sales.id} justify="space-between" py={4} gap="xs">
                    <Anchor component={Link} to={`/sales/${s.sales.id}`} ff="monospace" size="sm">{s.sales.invoice_no}</Anchor>
                    <Group gap="xs"><Text size="sm" c="dimmed">{shortDate(s.sales.created_at)}</Text><Money value={s.final_price} /><StatusBadge status={s.sales.status} /></Group>
                  </Group>
                ))}
              </Card>
            )}

            <Card>
              <Title order={5} mb="xs">Stock history</Title>
              <Table verticalSpacing={6} fz="sm">
                <Table.Tbody>
                  {(moves.data ?? []).map((m) => (
                    <Table.Tr key={m.id}>
                      <Table.Td><Text size="sm" fw={500}>{MOVE_LABEL[m.type] ?? m.type}</Text>{m.reason && <Text size="xs" c="dimmed">{m.reason}</Text>}</Table.Td>
                      <Table.Td ta="right" ff="monospace" c={m.qty > 0 ? "green.8" : "red.8"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</Table.Td>
                      <Table.Td ta="right"><Text size="xs" c="dimmed">{dateTime(m.created_at)}</Text><Text size="xs" c="dimmed">{m.profiles?.full_name}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      {isAdmin && (
        <>
          {/* Mounted only while open so each opening starts from fresh data. */}
          {editOpen && <EditItemModal item={it} opened onClose={edit.close} onSaved={refresh} />}
          {adjustOpen && <AdjustModal item={it} opened onClose={adjust.close} onSaved={refresh} />}
          {costOpen && costRow.isFetched && <CostModal itemId={it.id} cost={costRow.data ?? null} opened onClose={cost.close} onSaved={refresh} />}
        </>
      )}
    </>
  );
}

function EditItemModal({ item, opened, onClose, onSaved }: { item: FullItem; opened: boolean; onClose: () => void; onSaved: () => void }) {
  const categories = useCategories();
  const form = useForm({
    initialValues: {
      category_id: item.category_id, name: item.name, description: item.description ?? "", legacy_tag: item.legacy_tag ?? "",
      metal: item.metal, purity: item.purity, gross_weight_g: item.gross_weight_g ?? "", stone_weight_g: item.stone_weight_g,
      making_type: item.making_type, making_charge: item.making_charge, stone_charge: item.stone_charge,
      fixed_price: item.fixed_price ?? "", low_stock_at: item.low_stock_at ?? "",
    } as Record<string, string | number | null>,
  });
  const save = useMutation({
    mutationFn: async (v: typeof form.values) => unwrap(await supabase.from("items").update({
      category_id: v.category_id as string, name: String(v.name).trim(), description: (v.description as string) || null,
      legacy_tag: (v.legacy_tag as string) || null, metal: v.metal as string, purity: v.metal === "other" ? null : (v.purity as string | null),
      gross_weight_g: num(v.gross_weight_g), stone_weight_g: num(v.stone_weight_g) ?? 0,
      making_type: v.making_type as string, making_charge: num(v.making_charge) ?? 0, stone_charge: num(v.stone_charge) ?? 0,
      fixed_price: num(v.fixed_price), low_stock_at: num(v.low_stock_at),
    }).eq("id", item.id)),
    onSuccess: () => { notifications.show({ color: "green", message: "Item updated" }); onSaved(); onClose(); },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Edit item" size="lg">
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Category" data={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} {...form.getInputProps("category_id")} />
            <TextInput label="Name" {...form.getInputProps("name")} />
            <Select label="Metal" data={METALS.map((m) => ({ value: m.value, label: m.label }))} {...form.getInputProps("metal")} />
            <Select label="Purity" data={PURITIES[form.values.metal as string] ?? []} clearable allowDeselect {...form.getInputProps("purity")} />
            {item.tracking === "piece" && <NumberInput label="Gross weight (g)" decimalScale={3} {...form.getInputProps("gross_weight_g")} />}
            {item.tracking === "piece" && <NumberInput label="Stone weight (g)" decimalScale={3} {...form.getInputProps("stone_weight_g")} />}
            <Select label="Making type" data={[{ value: "per_gram", label: "Per gram" }, { value: "fixed", label: "Fixed" }]} {...form.getInputProps("making_type")} />
            <NumberInput label="Making charge" thousandSeparator="," {...form.getInputProps("making_charge")} />
            <NumberInput label="Stones / other charge" thousandSeparator="," {...form.getInputProps("stone_charge")} />
            <NumberInput label="Fixed price (leave empty for rate pricing)" thousandSeparator="," {...form.getInputProps("fixed_price")} />
            {item.tracking === "bulk" && <NumberInput label="Low stock warning at" allowDecimal={false} {...form.getInputProps("low_stock_at")} />}
            <TextInput label="Old tag number" {...form.getInputProps("legacy_tag")} />
          </SimpleGrid>
          <Textarea label="Notes" {...form.getInputProps("description")} />
          {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
          <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

function AdjustModal({ item, opened, onClose, onSaved }: { item: FullItem; opened: boolean; onClose: () => void; onSaved: () => void }) {
  const options = item.tracking === "piece"
    ? [
        ...(item.status === "in_stock" ? [{ value: "write_off", label: "Write off (lost, stolen, damaged, melted)" }] : []),
        ...(item.status === "written_off" ? [{ value: "restore", label: "Restore (found again)" }] : []),
        ...(item.status !== "in_stock" && !item.archived ? [{ value: "archive", label: "Archive (hide from lists)" }] : []),
        ...(item.archived ? [{ value: "unarchive", label: "Unarchive" }] : []),
      ]
    : [
        { value: "adjust", label: "Correct the quantity (+ or −)" },
        { value: "write_off", label: "Write off some (damaged, lost)" },
        ...(item.qty_on_hand === 0 && !item.archived ? [{ value: "archive", label: "Archive (discontinued)" }] : []),
        ...(item.archived ? [{ value: "unarchive", label: "Unarchive" }] : []),
      ];
  const [type, setType] = useState<string | null>(options[0]?.value ?? null);
  const [qty, setQty] = useState<string | number>("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("adjust_stock", {
      p_item_id: item.id, p_type: type!, p_reason: reason, p_qty_delta: num(qty) ?? undefined,
    })),
    onSuccess: () => { notifications.show({ color: "green", message: "Stock updated" }); setReason(""); setQty(""); onSaved(); onClose(); },
  });
  const needsQty = item.tracking === "bulk" && (type === "adjust" || type === "write_off");
  return (
    <Modal opened={opened} onClose={onClose} title="Adjust stock">
      <Stack>
        {options.length === 0 ? <Text c="dimmed">No adjustments available for a {item.status.replace("_", " ")} item.</Text> : (
          <>
            <Select label="What happened?" data={options} value={type} onChange={setType} />
            {needsQty && (
              <NumberInput label={type === "adjust" ? "Change in quantity (e.g. -2 or 3)" : "How many to write off"} allowDecimal={false}
                allowNegative={type === "adjust"} value={qty} onChange={setQty} description={`Currently ${item.qty_on_hand} in stock`} />
            )}
            <Textarea label="Reason (required)" placeholder="e.g. Found during stock check, damaged clasp…" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
            {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>Cancel</Button>
              <Button color={type === "write_off" ? "red" : undefined} disabled={reason.trim().length < 3 || !type} loading={save.isPending} onClick={() => save.mutate()}>Confirm</Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

function CostModal({ itemId, cost, opened, onClose, onSaved }: { itemId: string; cost: ItemCost | null; opened: boolean; onClose: () => void; onSaved: () => void }) {
  const form = useForm({
    initialValues: { cost_amount: cost?.cost_amount ?? "", supplier: cost?.supplier ?? "", purchase_date: cost?.purchase_date ?? "", notes: cost?.notes ?? "" } as Record<string, string | number>,
  });
  const save = useMutation({
    mutationFn: async (v: typeof form.values) => unwrap(await supabase.from("item_costs").upsert({
      item_id: itemId, cost_amount: num(v.cost_amount) ?? 0, supplier: (v.supplier as string) || null,
      purchase_date: (v.purchase_date as string) || null, notes: (v.notes as string) || null,
    })),
    onSuccess: () => { notifications.show({ color: "green", message: "Cost saved" }); onSaved(); onClose(); },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Cost & supplier (admin only)">
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <NumberInput label="Cost (per unit for bulk items)" min={0} thousandSeparator="," required {...form.getInputProps("cost_amount")} />
          <TextInput label="Supplier / karigar" {...form.getInputProps("supplier")} />
          <TextInput label="Purchase date" type="date" {...form.getInputProps("purchase_date")} />
          <Textarea label="Notes" {...form.getInputProps("notes")} />
          {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
          <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}
