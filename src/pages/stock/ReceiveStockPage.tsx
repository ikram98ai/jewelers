import {
  Alert, Button, Card, CloseButton, Divider, Grid, Group, Image, NumberInput, SegmentedControl, Select,
  SimpleGrid, Stack, Text, TextInput, Textarea, Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconPrinter } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Money, PageHeader } from "@/components/ui";
import { PhotoPicker } from "@/components/PhotoPicker";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { METALS, PURITIES, num, previewPrice } from "@/lib/format";
import { uploadItemPhoto } from "@/lib/photos";
import { useCategories, useRates } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useIsMobile } from "@/lib/useIsMobile";

type Mode = "piece" | "bulk" | "restock";
type N = number | string;

interface Values {
  category_id: string | null;
  name: string;
  metal: string;
  purity: string | null;
  gross_weight_g: N;
  stone_weight_g: N;
  making_type: "per_gram" | "fixed";
  making_charge: N;
  stone_charge: N;
  use_fixed_price: boolean;
  fixed_price: N;
  qty: N;
  low_stock_at: N;
  legacy_tag: string;
  description: string;
  cost_amount: N;
  supplier: string;
  restock_item_id: string | null;
}

const blank: Values = {
  category_id: null, name: "", metal: "gold", purity: "22K", gross_weight_g: "", stone_weight_g: 0,
  making_type: "per_gram", making_charge: "", stone_charge: 0, use_fixed_price: false, fixed_price: "",
  qty: 1, low_stock_at: "", legacy_tag: "", description: "", cost_amount: "", supplier: "", restock_item_id: null,
};

export default function ReceiveStockPage() {
  const isMobile = useIsMobile();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const rates = useRates();
  const [mode, setMode] = useState<Mode>("piece");
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; tag: string } | null>(null);

  const form = useForm<Values>({
    initialValues: blank,
    validate: (v) => {
      const e: Record<string, string> = {};
      if (mode === "restock") {
        if (!v.restock_item_id) e.restock_item_id = "Choose the item";
        if (!(num(v.qty)! >= 1)) e.qty = "At least 1";
        return e;
      }
      if (!v.category_id) e.category_id = "Choose a category";
      if (!v.name.trim()) e.name = "Give it a short name";
      const fixed = mode === "bulk" || v.use_fixed_price || v.metal === "other";
      if (fixed && !(num(v.fixed_price)! >= 0 && v.fixed_price !== "")) e.fixed_price = "Enter the sale price";
      if (!fixed) {
        if (!v.purity) e.purity = "Choose purity";
        if (!(num(v.gross_weight_g)! > 0)) e.gross_weight_g = "Enter the weight";
        if ((num(v.stone_weight_g) ?? 0) > (num(v.gross_weight_g) ?? 0)) e.stone_weight_g = "Stones can't weigh more than the piece";
      }
      if (mode === "bulk" && !(num(v.qty)! >= 1)) e.qty = "At least 1";
      return e;
    },
  });
  const v = form.values;

  // Default the mode's tracking when the category changes.
  useEffect(() => {
    const cat = categories.data?.find((c) => c.id === v.category_id);
    if (cat && mode !== "restock" && cat.default_tracking !== mode) setMode(cat.default_tracking as Mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.category_id]);

  const fixedMode = mode === "bulk" || v.use_fixed_price || v.metal === "other";
  const net = Math.max(0, (num(v.gross_weight_g) ?? 0) - (num(v.stone_weight_g) ?? 0));
  const rate = rates.rateFor(v.metal, v.purity);
  const price = previewPrice({
    rate, netWeight: net || null, makingType: v.making_type,
    makingCharge: num(v.making_charge), stoneCharge: num(v.stone_charge),
    fixedPrice: fixedMode ? num(v.fixed_price) : null,
  });

  const bulkItems = useQuery({
    queryKey: ["bulk-items"],
    enabled: mode === "restock",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_items", { p_tracking: "bulk", p_include_archived: true, p_status: "in_stock" })
        .select("id, tag, name, qty_on_hand");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; tag: string; name: string; qty_on_hand: number }[];
    },
  });

  const photoPreviews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => photoPreviews.forEach((u) => URL.revokeObjectURL(u)), [photoPreviews]);

  const submit = form.onSubmit(async (vals) => {
    setSaving(true);
    setError(null);
    try {
      const cost = isAdmin && vals.cost_amount !== ""
        ? { cost_amount: num(vals.cost_amount), supplier: vals.supplier || null }
        : null;
      let result: { item_id: string; tag: string };
      if (mode === "restock") {
        const { data, error: e } = await supabase.rpc("receive_stock", {
          p_item_id: vals.restock_item_id!, p_qty: num(vals.qty)!, p_cost: cost ?? undefined,
        });
        if (e) throw e;
        result = data as unknown as typeof result;
      } else {
        const item = {
          tracking: mode,
          category_id: vals.category_id,
          name: vals.name.trim(),
          description: vals.description,
          legacy_tag: vals.legacy_tag,
          metal: vals.metal,
          purity: vals.metal === "other" ? null : vals.purity,
          gross_weight_g: num(vals.gross_weight_g),
          stone_weight_g: num(vals.stone_weight_g) ?? 0,
          making_type: vals.making_type,
          making_charge: fixedMode ? 0 : (num(vals.making_charge) ?? 0),
          stone_charge: fixedMode ? 0 : (num(vals.stone_charge) ?? 0),
          fixed_price: fixedMode ? num(vals.fixed_price) : null,
          low_stock_at: mode === "bulk" ? num(vals.low_stock_at) : null,
        };
        const { data, error: e } = await supabase.rpc("receive_stock", {
          p_item: item, p_qty: mode === "bulk" ? num(vals.qty)! : 1, p_cost: cost ?? undefined,
        });
        if (e) throw e;
        result = data as unknown as typeof result;
        for (const [i, f] of photos.entries()) {
          try {
            await uploadItemPhoto(result.item_id, f, i);
          } catch (pe) {
            notifications.show({ color: "orange", message: `Item saved, but a photo failed: ${friendlyError(pe)}` });
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setSaved({ id: result.item_id, tag: result.tag });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  });

  const addAnother = () => {
    // Keep the "shape" of the last item so a batch of similar pieces is fast to enter.
    form.setValues({ ...v, name: "", gross_weight_g: "", stone_weight_g: 0, legacy_tag: "", description: "", cost_amount: "", restock_item_id: null, qty: 1 });
    form.resetDirty();
    setPhotos([]);
    setSaved(null);
  };

  if (saved) {
    return (
      <Card maw={520} mx="auto" mt={{ base: "md", sm: "xl" }} ta="center" p={{ base: "lg", sm: "xl" }}>
        <Stack align="center">
          <IconCheck size={48} color="var(--mantine-color-green-6)" />
          <Title order={3}>Saved</Title>
          <Text>Tag number</Text>
          <Text ff="monospace" fz={32} fw={700}>{saved.tag}</Text>
          <Text c="dimmed" size="sm">Write this on the tag, or print a label.</Text>
          <Group justify="center" className="mobile-fill">
            <Button leftSection={<IconPrinter size={18} />} variant="default" onClick={() => navigate(`/stock/labels?ids=${saved.id}`)}>Print label</Button>
            <Button component={Link} to={`/stock/${saved.id}`} variant="default">Open item</Button>
            <Button color="gold" onClick={addAnother}>Add another</Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Receive stock" subtitle="Add a new piece, a new bulk item, or more of an existing bulk item." />
      <form onSubmit={submit}>
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Card>
              <Stack>
                <SegmentedControl
                  fullWidth value={mode} onChange={(m) => setMode(m as Mode)}
                  data={[
                    { value: "piece", label: isMobile ? "Piece" : "Single piece" },
                    { value: "bulk", label: isMobile ? "New bulk" : "New bulk item" },
                    { value: "restock", label: isMobile ? "Restock" : "Restock bulk" },
                  ]}
                />

                {mode === "restock" ? (
                  <>
                    <Select
                      label="Bulk item" searchable placeholder="Search by name or tag"
                      data={(bulkItems.data ?? []).map((b) => ({ value: b.id, label: `${b.name} · ${b.tag} (${b.qty_on_hand} in stock)` }))}
                      {...form.getInputProps("restock_item_id")}
                    />
                    <NumberInput label="Quantity received" min={1} allowDecimal={false} {...form.getInputProps("qty")} />
                  </>
                ) : (
                  <>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <Select label="Category" placeholder="Choose" data={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} {...form.getInputProps("category_id")} />
                      <TextInput label="Name" placeholder={mode === "piece" ? "e.g. Ladies ring, floral" : "e.g. Silver nose pin, design 3"} {...form.getInputProps("name")} />
                    </SimpleGrid>
                    <SimpleGrid cols={{ base: 2 }}>
                      <Select label="Metal" data={METALS.map((m) => ({ value: m.value, label: m.label }))} value={v.metal}
                        onChange={(m) => form.setValues({ metal: m ?? "gold", purity: PURITIES[m ?? "gold"]?.[0] ?? null })} />
                      {v.metal !== "other" && (
                        <Select label="Purity" data={PURITIES[v.metal] ?? []} {...form.getInputProps("purity")} />
                      )}
                    </SimpleGrid>

                    {mode === "piece" && v.metal !== "other" && (
                      <SegmentedControl
                        fullWidth={isMobile}
                        value={v.use_fixed_price ? "fixed" : "rate"}
                        onChange={(x) => form.setFieldValue("use_fixed_price", x === "fixed")}
                        data={[{ value: "rate", label: isMobile ? "Today's rate" : "Price by today's rate" }, { value: "fixed", label: "Fixed price" }]}
                      />
                    )}

                    {mode === "piece" && (
                      <SimpleGrid cols={{ base: 2, sm: 3 }}>
                        <NumberInput label="Gross weight (g)" decimalScale={3} min={0} {...form.getInputProps("gross_weight_g")} />
                        <NumberInput label="Stone weight (g)" decimalScale={3} min={0} {...form.getInputProps("stone_weight_g")} />
                        <Stack gap={4} justify="flex-end">
                          <Text size="sm" fw={500}>Net weight</Text>
                          <Text ff="monospace" fz="lg" fw={700}>{net.toFixed(3)} g</Text>
                        </Stack>
                      </SimpleGrid>
                    )}

                    {!fixedMode && (
                      <SimpleGrid cols={{ base: 1, sm: 3 }}>
                        <Select label="Making charge" data={[{ value: "per_gram", label: "Per gram" }, { value: "fixed", label: "Fixed amount" }]} {...form.getInputProps("making_type")} />
                        <NumberInput label={v.making_type === "per_gram" ? "Making per gram" : "Making amount"} min={0} thousandSeparator="," {...form.getInputProps("making_charge")} />
                        <NumberInput label="Stones / other charge" min={0} thousandSeparator="," {...form.getInputProps("stone_charge")} />
                      </SimpleGrid>
                    )}

                    {fixedMode && (
                      <NumberInput label={mode === "bulk" ? "Sale price (each)" : "Fixed sale price"} min={0} thousandSeparator="," {...form.getInputProps("fixed_price")} />
                    )}

                    {mode === "bulk" && (
                      <SimpleGrid cols={{ base: 1, xs: 2 }}>
                        <NumberInput label="Quantity" min={1} allowDecimal={false} {...form.getInputProps("qty")} />
                        <NumberInput label="Warn when stock is at or below" min={0} allowDecimal={false} placeholder="optional" {...form.getInputProps("low_stock_at")} />
                      </SimpleGrid>
                    )}

                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <TextInput label="Old tag number" placeholder="optional" {...form.getInputProps("legacy_tag")} />
                      <Textarea label="Notes" placeholder="optional (design, stones, karigar…)" {...form.getInputProps("description")} />
                    </SimpleGrid>

                    <div>
                      <Text size="sm" fw={500} mb={6}>Photos (up to 4)</Text>
                      <Group gap="sm">
                        {photoPreviews.map((u, i) => (
                          <div key={u} style={{ position: "relative" }}>
                            <Image src={u} w={72} h={72} radius="md" fit="cover" alt="" />
                            <CloseButton size="sm" style={{ position: "absolute", top: 2, right: 2, background: "white" }}
                              onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label="Remove photo" />
                          </div>
                        ))}
                        <PhotoPicker max={4 - photos.length} h={72} onFiles={(fs) => setPhotos((p) => [...p, ...fs].slice(0, 4))} />
                      </Group>
                    </div>
                  </>
                )}

                {isAdmin && (
                  <>
                    <Divider label="Admin only — not visible to staff" labelPosition="left" />
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <NumberInput label={mode === "piece" ? "Purchase cost" : "Cost per unit"} min={0} thousandSeparator="," placeholder="optional" {...form.getInputProps("cost_amount")} />
                      <TextInput label="Supplier / karigar" placeholder="optional" {...form.getInputProps("supplier")} />
                    </SimpleGrid>
                  </>
                )}
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card style={{ position: "sticky", top: 80 }}>
              <Stack>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed">Price today</Text>
                {mode === "restock" ? <Text c="dimmed" size="sm">Uses the item's existing price.</Text> : (
                  <>
                    <Money value={price} fw={700} size="xl" />
                    {!fixedMode && (
                      <Text size="xs" c="dimmed">
                        {rate ? `${net.toFixed(3)} g × ${Math.round(rate).toLocaleString()} + making + stones` : `No rate set for ${v.metal} ${v.purity ?? ""}`}
                      </Text>
                    )}
                  </>
                )}
                {error && <Alert color="red">{error}</Alert>}
                <Button type="submit" size="lg" loading={saving} color="gold">Save</Button>
                <Button variant="subtle" component={Link} to="/stock">Cancel</Button>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </form>
    </>
  );
}
