import { Alert, Badge, Button, Card, Grid, Group, Progress, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck, IconClipboardCheck, IconScan } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ScanButton } from "@/components/ScanButton";
import { EmptyState, Loading, PageHeader, Weight } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { unwrap, useCategories } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

interface Check { id: string; category_id: string | null; started_at: string; status: string }
interface Missing { item_id: string; tag: string; name: string; net_weight_g: number | null; category: string }
interface ScanResult { item_id: string; tag: string; name: string; status: string; already_seen: boolean; unexpected: boolean }

export default function StockCheckPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState("");
  const [log, setLog] = useState<(ScanResult | { error: string; tag: string })[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = useQuery({
    queryKey: ["stock-check"],
    queryFn: async () => unwrap(await supabase.from("stock_checks").select("*").eq("status", "open").maybeSingle()) as Check | null,
  });
  const c = check.data;
  const found = useQuery({
    queryKey: ["stock-check", c?.id, "found"], enabled: !!c,
    queryFn: async () => {
      const { count, error } = await supabase.from("stock_check_items").select("item_id", { count: "exact", head: true }).eq("check_id", c!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const missing = useQuery({
    queryKey: ["stock-check", c?.id, "missing"], enabled: !!c,
    queryFn: async () => unwrap(await supabase.rpc("stock_check_missing", { p_check_id: c!.id })) as Missing[],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["stock-check"] });

  const start = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("start_stock_check", { p_category_id: category ?? undefined })),
    onSuccess: refresh,
    onError: (e) => notifications.show({ color: "red", message: friendlyError(e) }),
  });
  const scan = async (t: string) => {
    if (!c || !t.trim()) return;
    setTag("");
    const { data, error } = await supabase.rpc("stock_check_scan", { p_check_id: c.id, p_tag: t });
    setLog((l) => [error ? { error: friendlyError(error), tag: t } : (data as unknown as ScanResult), ...l].slice(0, 30));
    refresh();
    inputRef.current?.focus();
  };
  const writeOff = useMutation({
    mutationFn: async (m: Missing) => unwrap(await supabase.rpc("adjust_stock", {
      p_item_id: m.item_id, p_type: "write_off", p_reason: `Missing in stock check started ${dateTime(c!.started_at)}`,
    })),
    onSuccess: () => { refresh(); queryClient.invalidateQueries({ queryKey: ["items"] }); },
    onError: (e) => notifications.show({ color: "red", message: friendlyError(e) }),
  });
  const complete = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("complete_stock_check", { p_check_id: c!.id })) as unknown as { expected: number; found: number; missing: number },
    onSuccess: (r) => {
      notifications.show({ color: r.missing ? "orange" : "green", title: "Stock check completed", message: `${r.found} of ${r.expected} pieces found` });
      setLog([]);
      refresh();
    },
  });

  if (check.isLoading) return <Loading />;

  if (!c) {
    return (
      <>
        <PageHeader title="Stock check" subtitle="Scan every piece in the shop to find anything missing." />
        {isAdmin ? (
          <Card maw={520}>
            <Stack>
              <Select label="What to check" placeholder="All pieces" clearable allowDeselect value={category} onChange={setCategory}
                data={(categories.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
              <Button color="gold" leftSection={<IconClipboardCheck size={18} />} loading={start.isPending} onClick={() => start.mutate()}>Start stock check</Button>
              <Text size="xs" c="dimmed">Staff can help scan on their phones once it's started.</Text>
            </Stack>
          </Card>
        ) : <EmptyState title="No stock check running">An admin starts stock checks.</EmptyState>}
      </>
    );
  }

  const total = (found.data ?? 0) + (missing.data?.length ?? 0);
  const pct = total ? Math.round(((found.data ?? 0) / total) * 100) : 0;
  const catName = categories.data?.find((x) => x.id === c.category_id)?.name ?? "All pieces";

  return (
    <>
      <PageHeader title="Stock check" subtitle={`${catName} · started ${dateTime(c.started_at)}`}
        actions={isAdmin && (
          <Button color="green" leftSection={<IconCheck size={18} />} loading={complete.isPending}
            onClick={() => modals.openConfirmModal({
              title: "Finish stock check?",
              children: <Text size="sm">{missing.data?.length ? `${missing.data.length} piece(s) were not scanned. You can still write them off afterwards from each item.` : "Every piece was found."}</Text>,
              labels: { confirm: "Finish", cancel: "Keep scanning" }, onConfirm: () => complete.mutate(),
            })}>Finish</Button>
        )} />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card mb="md">
            <Group justify="space-between" mb={6}><Text fw={600}>{found.data ?? 0} of {total} found</Text><Text c="dimmed">{pct}%</Text></Group>
            <Progress value={pct} color={pct === 100 ? "green" : "gold"} size="lg" radius="xl" />
            <Group mt="md" gap="sm" wrap="nowrap">
              <TextInput ref={inputRef} flex={1} size="lg" leftSection={<IconScan size={20} />} placeholder="Scan or type tag" autoFocus
                value={tag} onChange={(e) => setTag(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") scan(tag); }} />
              <ScanButton compact onScan={scan} />
            </Group>
          </Card>
          <Card>
            <Title order={5} mb="xs">Last scanned</Title>
            {log.length === 0 ? <Text size="sm" c="dimmed">Nothing yet.</Text> : (
              <Stack gap={6}>
                {log.map((l, i) => "error" in l ? (
                  <Alert key={i} color="red" p="xs" icon={<IconAlertTriangle size={16} />}><Text size="sm">{l.tag}: {l.error}</Text></Alert>
                ) : (
                  <Group key={i} justify="space-between" wrap="nowrap">
                    <div><Text size="sm" fw={500}>{l.name}</Text><Text size="xs" ff="monospace" c="dimmed">{l.tag}</Text></div>
                    {l.unexpected ? <Badge color="red">{l.status === "in_stock" ? "other category" : l.status.replace("_", " ")}</Badge>
                      : l.already_seen ? <Badge color="gray">already scanned</Badge> : <Badge color="green">found</Badge>}
                  </Group>
                ))}
              </Stack>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card>
            <Title order={5} mb="xs">Not scanned yet ({missing.data?.length ?? 0})</Title>
            {(missing.data ?? []).length === 0 ? <Text size="sm" c="green">Everything is accounted for.</Text> : (
              <Table verticalSpacing={6}>
                <Table.Tbody>
                  {missing.data!.map((m) => (
                    <Table.Tr key={m.item_id}>
                      <Table.Td><Text size="sm" fw={500}>{m.name}</Text><Text size="xs" ff="monospace" c="dimmed">{m.tag} · {m.category}</Text></Table.Td>
                      <Table.Td><Weight grams={m.net_weight_g} size="xs" /></Table.Td>
                      {isAdmin && (
                        <Table.Td ta="right">
                          <Button size="compact-xs" variant="subtle" color="red" onClick={() => modals.openConfirmModal({
                            title: `Write off ${m.tag}?`, children: <Text size="sm">Only do this after searching for it. It can be restored if found.</Text>,
                            labels: { confirm: "Write off", cancel: "Cancel" }, confirmProps: { color: "red" }, onConfirm: () => writeOff.mutate(m),
                          })}>Write off</Button>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}
