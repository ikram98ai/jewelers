import { Alert, Button, Card, FileButton, Group, List, Stack, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconFileImport, IconUpload } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { friendlyError } from "@/lib/errors";
import { unwrap, useCategories } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

const COLUMNS = [
  "category", "name", "tracking", "metal", "purity", "gross_weight_g", "stone_weight_g", "making_type",
  "making_charge", "stone_charge", "fixed_price", "qty", "low_stock_at", "legacy_tag", "description", "cost_amount", "supplier",
] as const;
const NUMERIC = new Set(["gross_weight_g", "stone_weight_g", "making_charge", "stone_charge", "fixed_price", "qty", "low_stock_at", "cost_amount"]);

type Row = Record<(typeof COLUMNS)[number], string | number | null>;

export default function ImportPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  const template = () => downloadCsv("stock-import-template", [...COLUMNS], [
    ["Ring", "Ladies ring, floral", "piece", "gold", "22K", 4.12, 0, "per_gram", 1800, 0, "", 1, "", "A-102", "", 75000, "Karigar Bashir"],
    ["Nose pin", "Silver nose pin, design 3", "bulk", "silver", "925", "", 0, "", "", "", 1500, 24, 5, "", "", 900, ""],
  ]);

  const load = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const table = parseCsv(await file.text());
    const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
    const missing = ["category", "name"].filter((c) => !header.includes(c));
    const issues: string[] = [];
    if (missing.length) issues.push(`Missing column(s): ${missing.join(", ")}. Download the template.`);
    const catNames = new Set((categories.data ?? []).flatMap((c) => [c.name.toLowerCase(), c.tag_prefix]));
    const parsed: Row[] = table.slice(1).map((cells, i) => {
      const r = {} as Row;
      for (const col of COLUMNS) {
        const raw = (cells[header.indexOf(col)] ?? "").trim();
        if (header.indexOf(col) < 0 || raw === "") { r[col] = null; continue; }
        if (NUMERIC.has(col)) {
          const n = Number(raw.replace(/,/g, ""));
          if (!Number.isFinite(n)) issues.push(`Row ${i + 1}: "${col}" is not a number (${raw})`);
          r[col] = Number.isFinite(n) ? n : null;
        } else r[col] = raw;
      }
      if (!r.name) issues.push(`Row ${i + 1}: name is empty`);
      if (r.category && !catNames.has(String(r.category).toLowerCase()) && !catNames.has(String(r.category).toUpperCase())) {
        issues.push(`Row ${i + 1}: unknown category "${r.category}" (add it in Settings first)`);
      }
      return r;
    });
    setRows(parsed);
    setProblems(issues.slice(0, 20));
  };

  const run = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("import_items", { p_rows: rows })) as unknown as { imported: number },
    onSuccess: (r) => {
      ["items", "dashboard", "categories"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      notifications.show({ color: "green", title: "Import complete", message: `${r.imported} items added with new tags.` });
      navigate("/stock");
    },
  });

  return (
    <>
      <PageHeader title="Import stock" subtitle="Load existing stock from a spreadsheet. It's all-or-nothing: if any row is wrong, nothing is imported."
        actions={<Button variant="default" leftSection={<IconDownload size={18} />} onClick={template}>Download template</Button>} />
      <Card mb="md">
        <Stack>
          <Text size="sm">
            Fill one row per piece (or per bulk design), save as <b>CSV</b>, then choose the file. New tag numbers are generated;
            put existing tag numbers in <code>legacy_tag</code> so staff can still search by them.
          </Text>
          <Group>
            <FileButton onChange={load} accept=".csv,text/csv">
              {(props) => <Button {...props} leftSection={<IconUpload size={18} />}>Choose CSV file</Button>}
            </FileButton>
            {fileName && <Text size="sm" c="dimmed">{fileName}: {rows.length} rows</Text>}
          </Group>
        </Stack>
      </Card>

      {problems.length > 0 && (
        <Alert color="orange" mb="md" title="Fix these first">
          <List size="sm">{problems.map((p) => <List.Item key={p}>{p}</List.Item>)}</List>
        </Alert>
      )}

      {rows.length > 0 && (
        <Card padding={0} mb="md">
          <Table.ScrollContainer minWidth={900}>
            <Table fz="xs" verticalSpacing={4}>
              <Table.Thead><Table.Tr><Table.Th>#</Table.Th>{COLUMNS.slice(0, 12).map((c) => <Table.Th key={c}>{c}</Table.Th>)}</Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.slice(0, 25).map((r, i) => (
                  <Table.Tr key={i}><Table.Td>{i + 1}</Table.Td>{COLUMNS.slice(0, 12).map((c) => <Table.Td key={c}>{r[c] ?? ""}</Table.Td>)}</Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {rows.length > 25 && <Text size="xs" c="dimmed" p="sm">…and {rows.length - 25} more rows</Text>}
        </Card>
      )}

      {run.error && <Alert color="red" mb="md">{friendlyError(run.error)}</Alert>}
      <Group justify="flex-end">
        <Button size="md" color="gold" leftSection={<IconFileImport size={18} />} disabled={!rows.length || problems.length > 0}
          loading={run.isPending} onClick={() => run.mutate()}>
          Import {rows.length || ""} items
        </Button>
      </Group>
    </>
  );
}
