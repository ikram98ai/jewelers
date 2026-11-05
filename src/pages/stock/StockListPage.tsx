import {
  ActionIcon, Badge, Button, Card, Checkbox, Group, Menu, Pagination, SegmentedControl, Select, Stack, Table, Text, TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconClipboardCheck, IconDots, IconDownload, IconFileImport, IconPlus, IconPrinter, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ItemThumb } from "@/components/ItemThumb";
import { ScanButton } from "@/components/ScanButton";
import { EmptyState, ErrorText, Loading, Money, PageHeader, PurityBadge, StatusBadge, Weight } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { downloadCsv } from "@/lib/csv";
import { METALS } from "@/lib/format";
import { useSignedUrls } from "@/lib/photos";
import { useCategories } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Item } from "@/lib/types";
import { useIsMobile } from "@/lib/useIsMobile";

const PAGE = 50;

type Row = Item & {
  suggested_price: number | null;
  categories: { name: string } | null;
  item_photos: { storage_path: string; sort_order: number }[];
};

export default function StockListPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debouncedQ] = useDebouncedValue(q, 250);
  const [status, setStatus] = useState(params.get("status") ?? "in_stock");
  const [categoryId, setCategoryId] = useState<string | null>(params.get("category"));
  const [metal, setMetal] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const missingCost = isAdmin && params.get("missingCost") === "1";
  const categories = useCategories();
  const isMobile = useIsMobile();

  useEffect(() => setPage(1), [debouncedQ, status, categoryId, metal, missingCost]);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debouncedQ) next.set("q", debouncedQ); else next.delete("q");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const filters = { q: debouncedQ, status, categoryId, metal, page, missingCost };
  const query = useQuery({
    queryKey: ["items", filters],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const select = missingCost
        ? "*, suggested_price, categories(name), item_photos(storage_path, sort_order), item_costs(item_id)"
        : "*, suggested_price, categories(name), item_photos(storage_path, sort_order)";
      let req = supabase
        .rpc("search_items", {
          p_q: debouncedQ || undefined,
          p_status: status === "all" ? undefined : status,
          p_category_id: categoryId ?? undefined,
          p_metal: metal ?? undefined,
        }, { count: "exact" })
        .select(select);
      if (missingCost) req = req.is("item_costs", null);
      const { data, error, count } = await req.range((page - 1) * PAGE, page * PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], count: count ?? 0 };
    },
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const firstPhotos = useMemo(
    () => rows.map((r) => [...r.item_photos].sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path).filter(Boolean) as string[],
    [rows],
  );
  const urls = useSignedUrls(firstPhotos).data ?? {};
  const thumb = (r: Row) => {
    const p = [...r.item_photos].sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path;
    return p ? urls[p] : null;
  };

  // A scanned/typed exact tag jumps straight to the item.
  const onScan = async (text: string) => {
    const tag = text.trim().toUpperCase();
    const { data } = await supabase.from("items").select("id").eq("tag", tag).maybeSingle();
    if (data) navigate(`/stock/${data.id}`);
    else setQ(text);
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const exportCsv = async () => {
    const { data, error } = await supabase
      .rpc("search_items", {
        p_q: debouncedQ || undefined,
        p_status: status === "all" ? undefined : status,
        p_category_id: categoryId ?? undefined,
        p_metal: metal ?? undefined,
      })
      .select("*, suggested_price, categories(name)");
    if (error) return;
    const list = (data ?? []) as unknown as Row[];
    downloadCsv(`stock-${new Date().toISOString().slice(0, 10)}`,
      ["Tag", "Legacy tag", "Name", "Category", "Type", "Metal", "Purity", "Gross g", "Stone g", "Net g", "Making", "Making type", "Stone charge", "Fixed price", "Qty", "Status", "Suggested price"],
      list.map((r) => [r.tag, r.legacy_tag, r.name, r.categories?.name, r.tracking, r.metal, r.purity, r.gross_weight_g, r.stone_weight_g,
        r.net_weight_g, r.making_charge, r.making_type, r.stone_charge, r.fixed_price, r.qty_on_hand, r.status, r.suggested_price]));
  };

  const total = query.data?.count ?? 0;

  return (
    <>
      <PageHeader
        title={missingCost ? "Items missing a cost" : "Stock"}
        subtitle={`${total.toLocaleString()} item${total === 1 ? "" : "s"}`}
        actions={
          <>
            {selected.length > 0 && (
              <Button variant="default" leftSection={<IconPrinter size={18} />} onClick={() => navigate(`/stock/labels?ids=${selected.join(",")}`)}>
                Print {selected.length} label{selected.length === 1 ? "" : "s"}
              </Button>
            )}
            <Button variant="default" leftSection={<IconClipboardCheck size={18} />} component={Link} to="/stock/check" visibleFrom="sm">Stock check</Button>
            {isAdmin && <Button variant="default" leftSection={<IconFileImport size={18} />} component={Link} to="/stock/import" visibleFrom="sm">Import</Button>}
            <Button variant="default" leftSection={<IconDownload size={18} />} onClick={exportCsv} visibleFrom="sm">CSV</Button>
            <Button leftSection={<IconPlus size={18} />} component={Link} to="/stock/new">Receive stock</Button>
            {/* Phones: the secondary actions live in an overflow menu. */}
            <Menu position="bottom-end" width={200}>
              <Menu.Target>
                <ActionIcon variant="default" size="input-md" aria-label="More stock actions" hiddenFrom="sm"><IconDots size={20} /></ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconClipboardCheck size={16} />} component={Link} to="/stock/check">Stock check</Menu.Item>
                {isAdmin && <Menu.Item leftSection={<IconFileImport size={16} />} component={Link} to="/stock/import">Import</Menu.Item>}
                <Menu.Item leftSection={<IconDownload size={16} />} onClick={exportCsv}>Download CSV</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
      />

      <Card mb="md" padding="md">
        <Stack gap="sm">
          <Group gap="sm" wrap="nowrap">
            <TextInput
              flex={1}
              miw={0}
              placeholder={isMobile ? "Tag, name or weight" : "Search tag, name, or weight (e.g. 4.12)"}
              leftSection={<IconSearch size={18} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") onScan(q); }}
            />
            <ScanButton compact onScan={onScan} />
          </Group>
          <Group gap="sm" wrap="wrap">
            <SegmentedControl
              w={{ base: "100%", xs: "auto" }}
              value={status}
              onChange={setStatus}
              data={[
                { value: "in_stock", label: "In stock" },
                { value: "sold", label: "Sold" },
                { value: "written_off", label: "Written off" },
                { value: "all", label: "All" },
              ]}
            />
            <Select
              placeholder="All categories" clearable allowDeselect flex={{ base: "1 1 140px", sm: "0 0 180px" }} size="sm"
              data={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              value={categoryId} onChange={setCategoryId}
            />
            <Select
              placeholder="All metals" clearable allowDeselect flex={{ base: "1 1 120px", sm: "0 0 150px" }} size="sm"
              data={METALS.map((m) => ({ value: m.value, label: m.label }))}
              value={metal} onChange={setMetal}
            />
          </Group>
        </Stack>
      </Card>

      <ErrorText error={query.error} />
      {query.isLoading ? <Loading /> : rows.length === 0 ? (
        <EmptyState title="No items found">
          {debouncedQ ? "Try a different search, or clear the filters." : "Receive your first piece to get started."}
        </EmptyState>
      ) : (
        <>
          {/* Desktop table */}
          <Card padding={0} visibleFrom="sm">
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36} />
                  <Table.Th>Item</Table.Th>
                  <Table.Th>Metal</Table.Th>
                  <Table.Th ta="right">Net weight</Table.Th>
                  <Table.Th ta="right">Price today</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id} data-clickable onClick={() => navigate(`/stock/${r.id}`)}>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.tag}`} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <ItemThumb url={thumb(r)} size={44} />
                        <div>
                          <Text fw={600} size="sm">{r.name}</Text>
                          <Text size="xs" c="dimmed" ff="monospace">{r.tag}{r.legacy_tag ? ` · ${r.legacy_tag}` : ""} · {r.categories?.name}</Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td><PurityBadge metal={r.metal} purity={r.purity} /></Table.Td>
                    <Table.Td ta="right">{r.tracking === "bulk" ? <Badge color="blue" variant="light">{r.qty_on_hand} pcs</Badge> : <Weight grams={r.net_weight_g} size="sm" />}</Table.Td>
                    <Table.Td ta="right"><Money value={r.suggested_price} fw={600} /></Table.Td>
                    <Table.Td><StatusBadge status={r.status} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <Stack gap="xs" hiddenFrom="sm">
            {rows.map((r) => (
              <Card key={r.id} padding="sm" onClick={() => navigate(`/stock/${r.id}`)} style={{ cursor: "pointer" }}>
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Checkbox
                    size="md" mt={16} checked={selected.includes(r.id)} aria-label={`Select ${r.tag} for labels`}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)}
                  />
                  <ItemThumb url={thumb(r)} size={56} />
                  <Stack gap={2} flex={1} miw={0}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text fw={600} size="sm" truncate miw={0}>{r.name}</Text>
                      <div style={{ flexShrink: 0 }}><Money value={r.suggested_price} fw={700} size="sm" /></div>
                    </Group>
                    <Text size="xs" c="dimmed" ff="monospace" truncate>{r.tag}{r.legacy_tag ? ` · ${r.legacy_tag}` : ""}</Text>
                    <Group gap={6}>
                      <PurityBadge metal={r.metal} purity={r.purity} />
                      {r.tracking === "bulk" ? <Badge color="blue">{r.qty_on_hand} pcs</Badge> : <Weight grams={r.net_weight_g} size="xs" />}
                      {r.status !== "in_stock" && <StatusBadge status={r.status} />}
                    </Group>
                  </Stack>
                </Group>
              </Card>
            ))}
          </Stack>

          {total > PAGE && (
            <Group justify="center" mt="lg">
              <Pagination total={Math.ceil(total / PAGE)} value={page} onChange={setPage} siblings={isMobile ? 0 : 1} />
            </Group>
          )}
        </>
      )}
    </>
  );
}
