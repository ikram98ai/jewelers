import { Alert, Button, Card, Grid, Group, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loading, PageHeader } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { unwrap, useCategories, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { ShopSettings } from "@/lib/types";

export default function SettingsPage() {
  const { settings, isLoading } = useSettings();
  if (isLoading || !settings) return <Loading />;
  return (
    <>
      <PageHeader title="Settings" subtitle="Shop details printed on invoices, money and weight display, and item categories." />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 7 }}><ShopForm settings={settings} /></Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}><Categories /></Grid.Col>
      </Grid>
    </>
  );
}

function ShopForm({ settings }: { settings: ShopSettings }) {
  const queryClient = useQueryClient();
  const form = useForm({
    initialValues: {
      shop_name: settings.shop_name, address: settings.address ?? "", phone: settings.phone ?? "",
      currency_code: settings.currency_code, currency_symbol: settings.currency_symbol, weight_unit: settings.weight_unit,
      invoice_prefix: settings.invoice_prefix, old_gold_deduction_pct: Number(settings.old_gold_deduction_pct),
      timezone: settings.timezone, phone_country_code: settings.phone_country_code,
    },
    validate: {
      shop_name: (v) => (v.trim() ? null : "Required"),
      currency_code: (v) => (/^[A-Z]{3}$/.test(v) ? null : "3 capital letters, e.g. PKR"),
      invoice_prefix: (v) => (/^[A-Z0-9]{1,8}$/.test(v) ? null : "1–8 capital letters/digits"),
      phone_country_code: (v) => (/^\d{1,4}$/.test(v) ? null : "Digits only, e.g. 92"),
    },
  });
  const save = useMutation({
    mutationFn: async (v: typeof form.values) => unwrap(await supabase.from("shop_settings").update({
      ...v, address: v.address || null, phone: v.phone || null,
    }).eq("id", 1)),
    onSuccess: () => { notifications.show({ color: "green", message: "Settings saved" }); queryClient.invalidateQueries({ queryKey: ["settings"] }); },
  });
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [settings.timezone];
  return (
    <Card>
      <Title order={4} mb="md">Shop</Title>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <TextInput label="Shop name" {...form.getInputProps("shop_name")} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Address" {...form.getInputProps("address")} />
            <TextInput label="Phone" {...form.getInputProps("phone")} />
            <TextInput label="Currency code" {...form.getInputProps("currency_code")} onChange={(e) => form.setFieldValue("currency_code", e.currentTarget.value.toUpperCase())} />
            <TextInput label="Currency symbol" {...form.getInputProps("currency_symbol")} />
            <Select label="Show weights in" data={[{ value: "g", label: "Grams" }, { value: "tola", label: "Grams + tola" }]} {...form.getInputProps("weight_unit")} />
            <TextInput label="Invoice prefix" description="e.g. INV → INV-2026-00001" {...form.getInputProps("invoice_prefix")}
              onChange={(e) => form.setFieldValue("invoice_prefix", e.currentTarget.value.toUpperCase())} />
            <NumberInput label="Default old-gold deduction %" min={0} max={50} decimalScale={2} {...form.getInputProps("old_gold_deduction_pct")} />
            <TextInput label="Phone country code" description="For WhatsApp links, e.g. 92" {...form.getInputProps("phone_country_code")} />
            <Select label="Shop timezone" description="Decides what 'today' means for rates and reports" searchable data={zones} {...form.getInputProps("timezone")} />
          </SimpleGrid>
          {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
          <Group justify="flex-end"><Button type="submit" loading={save.isPending}>Save settings</Button></Group>
        </Stack>
      </form>
    </Card>
  );
}

function Categories() {
  const categories = useCategories();
  const queryClient = useQueryClient();
  const form = useForm({
    initialValues: { name: "", tag_prefix: "", default_tracking: "piece" },
    validate: {
      name: (v) => (v.trim() ? null : "Required"),
      tag_prefix: (v) => (/^[A-Z]{2,5}$/.test(v) ? null : "2–5 capital letters"),
    },
  });
  const add = useMutation({
    mutationFn: async (v: typeof form.values) => unwrap(await supabase.from("categories").insert({ ...v, name: v.name.trim() })),
    onSuccess: () => { form.reset(); queryClient.invalidateQueries({ queryKey: ["categories"] }); },
  });
  return (
    <Card>
      <Title order={4} mb="xs">Categories</Title>
      <Text size="sm" c="dimmed" mb="md">The prefix starts each tag number. It can't be changed later, so labels always stay valid.</Text>
      <Table verticalSpacing={6} mb="md">
        <Table.Tbody>
          {(categories.data ?? []).map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td>{c.name}</Table.Td>
              <Table.Td ff="monospace" fz="sm">{c.tag_prefix}-{String(c.next_seq).padStart(5, "0")}</Table.Td>
              <Table.Td><Text size="xs" c="dimmed">{c.default_tracking === "piece" ? "single pieces" : "bulk"}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <form onSubmit={form.onSubmit((v) => add.mutate(v))}>
        <Stack gap="xs">
          <SimpleGrid cols={2}>
            <TextInput size="sm" placeholder="Name, e.g. Tikka" {...form.getInputProps("name")} />
            <TextInput size="sm" placeholder="Prefix, e.g. TKA" {...form.getInputProps("tag_prefix")} onChange={(e) => form.setFieldValue("tag_prefix", e.currentTarget.value.toUpperCase())} />
          </SimpleGrid>
          <Group>
            <Select size="sm" flex={1} data={[{ value: "piece", label: "Single pieces" }, { value: "bulk", label: "Bulk (by quantity)" }]} {...form.getInputProps("default_tracking")} />
            <Button size="sm" leftSection={<IconPlus size={16} />} type="submit" loading={add.isPending}>Add</Button>
          </Group>
          {add.error && <Text c="red" size="sm">{friendlyError(add.error)}</Text>}
        </Stack>
      </form>
    </Card>
  );
}
