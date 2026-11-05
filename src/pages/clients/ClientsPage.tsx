import { Button, Card, Group, Stack, Table, Text, TextInput } from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { IconDownload, IconSearch, IconUserPlus } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, ErrorText, Loading, Money, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { downloadCsv } from "@/lib/csv";
import { phoneDisplay } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Client } from "@/lib/types";
import { ClientFormModal } from "./ClientFormModal";

export default function ClientsPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced] = useDebouncedValue(q, 250);
  const [newOpen, newModal] = useDisclosure(false);

  const clients = useQuery({
    queryKey: ["clients", debounced],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_clients", { p_q: debounced || undefined }).limit(100);
      if (error) throw error;
      return data as Client[];
    },
  });
  const ids = (clients.data ?? []).map((c) => c.id);
  const balances = useQuery({
    queryKey: ["clients", "balances", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("client_balances").select("client_id, balance, last_purchase_at").in("client_id", ids);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((b) => [b.client_id, b]));
    },
  });

  const exportCsv = async () => {
    const { data } = await supabase.from("clients").select("*").eq("archived", false).order("full_name");
    downloadCsv("clients", ["Name", "Phone", "Other phone", "City", "Address", "Birthday", "Anniversary", "Notes"],
      (data ?? []).map((c) => [c.full_name, c.phone, c.alt_phone, c.city, c.address, c.birthday, c.anniversary, c.notes]));
  };

  const rows = clients.data ?? [];
  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Search by phone number or name"
        actions={
          <>
            {isAdmin && <Button variant="default" leftSection={<IconDownload size={18} />} onClick={exportCsv}>CSV</Button>}
            <Button leftSection={<IconUserPlus size={18} />} onClick={newModal.open}>New client</Button>
          </>
        }
      />
      <TextInput mb="md" size="lg" leftSection={<IconSearch size={20} />} placeholder="0300… or name" value={q} onChange={(e) => setQ(e.currentTarget.value)} autoFocus inputMode="search" />
      <ErrorText error={clients.error} />
      {clients.isLoading ? <Loading /> : rows.length === 0 ? (
        <EmptyState title={debounced ? "No client found" : "No clients yet"}>
          {debounced ? <Button mt="sm" variant="light" onClick={newModal.open}>Add “{debounced}” as a new client</Button> : "Add your first client."}
        </EmptyState>
      ) : (
        <>
          <Card padding={0} visibleFrom="sm">
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Phone</Table.Th><Table.Th>City</Table.Th><Table.Th ta="right">Balance due</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.map((c) => {
                  const bal = Number(balances.data?.[c.id]?.balance ?? 0);
                  return (
                    <Table.Tr key={c.id} data-clickable onClick={() => navigate(`/clients/${c.id}`)}>
                      <Table.Td fw={500}>{c.full_name}</Table.Td>
                      <Table.Td ff="monospace" fz="sm">{phoneDisplay(c.phone)}</Table.Td>
                      <Table.Td>{c.city}</Table.Td>
                      <Table.Td ta="right">{bal > 0 ? <Money value={bal} fw={600} c="orange.8" /> : <Text size="sm" c="dimmed">—</Text>}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Card>
          <Stack gap="xs" hiddenFrom="sm">
            {rows.map((c) => {
              const bal = Number(balances.data?.[c.id]?.balance ?? 0);
              return (
                <Card key={c.id} padding="sm" onClick={() => navigate(`/clients/${c.id}`)} style={{ cursor: "pointer" }}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <div style={{ minWidth: 0 }}>
                      <Text fw={600} size="sm" truncate>{c.full_name}</Text>
                      <Text size="xs" c="dimmed" ff="monospace">{phoneDisplay(c.phone)}{c.city ? <Text span ff="text" size="xs"> · {c.city}</Text> : null}</Text>
                    </div>
                    {bal > 0 && <Money value={bal} fw={600} size="sm" c="orange.8" />}
                  </Group>
                </Card>
              );
            })}
          </Stack>
        </>
      )}
      {newOpen && (
        <ClientFormModal opened onClose={newModal.close} initialPhone={/\d{4,}/.test(debounced) ? debounced : ""}
          onSaved={(c) => navigate(`/clients/${c.id}`)} />
      )}
    </>
  );
}
