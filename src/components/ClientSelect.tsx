import { Button, Combobox, Group, InputBase, Loader, Text, useCombobox } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconSearch, IconUserPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { phoneDisplay } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Client } from "@/lib/types";
import { ClientFormModal } from "@/pages/clients/ClientFormModal";

/** Pick a client by phone or name, or add a new one. Shows the chosen client with a Change button. */
export function ClientSelect({ value, onChange, label = "Client" }: { value: Client | null; onChange: (c: Client | null) => void; label?: string }) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 200);
  const [newOpen, setNewOpen] = useState(false);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const results = useQuery({
    queryKey: ["clients", "select", debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_clients", { p_q: debounced }).limit(8);
      if (error) throw error;
      return data as Client[];
    },
  });

  if (value) {
    return (
      <Group justify="space-between" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed">{label}</Text>
          <Text fw={600}>{value.full_name}</Text>
          <Text size="sm" c="dimmed">{phoneDisplay(value.phone)}{value.city ? ` · ${value.city}` : ""}</Text>
        </div>
        <Button variant="subtle" size="xs" onClick={() => { setSearch(""); onChange(null); }}>Change</Button>
      </Group>
    );
  }

  return (
    <>
      <Text size="sm" fw={500} mb={4}>{label}</Text>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Combobox store={combobox} onOptionSubmit={(id) => {
          const c = results.data?.find((x) => x.id === id);
          if (c) onChange(c);
          combobox.closeDropdown();
        }}>
          <Combobox.Target>
            <InputBase flex={1} leftSection={<IconSearch size={18} />} rightSection={results.isFetching ? <Loader size="xs" /> : null}
              placeholder="Search phone or name" value={search} inputMode="search"
              onChange={(e) => { setSearch(e.currentTarget.value); combobox.openDropdown(); }}
              onFocus={() => combobox.openDropdown()} onBlur={() => combobox.closeDropdown()} />
          </Combobox.Target>
          <Combobox.Dropdown hidden={debounced.trim().length < 2}>
            <Combobox.Options>
              {(results.data ?? []).map((c) => (
                <Combobox.Option value={c.id} key={c.id}>
                  <Text size="sm" fw={500}>{c.full_name}</Text>
                  <Text size="xs" c="dimmed">{phoneDisplay(c.phone)}{c.city ? ` · ${c.city}` : ""}</Text>
                </Combobox.Option>
              ))}
              {results.data?.length === 0 && <Combobox.Empty>No client found</Combobox.Empty>}
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>
        <Button variant="light" leftSection={<IconUserPlus size={18} />} onClick={() => setNewOpen(true)}>New</Button>
      </Group>
      {newOpen && (
        <ClientFormModal opened onClose={() => setNewOpen(false)}
          initialPhone={/^\d+$/.test(search.replace(/\D/g, "")) ? search : ""} onSaved={(c) => onChange(c)} />
      )}
    </>
  );
}
