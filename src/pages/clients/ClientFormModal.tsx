import { Alert, Button, Group, Modal, SimpleGrid, Stack, TextInput, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { friendlyError } from "@/lib/errors";
import { unwrap } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Client } from "@/lib/types";

const digits = (s: string) => s.replace(/\D/g, "");

export function ClientFormModal({ opened, onClose, client, initialPhone, onSaved }: {
  opened: boolean;
  onClose: () => void;
  client?: Client | null;
  initialPhone?: string;
  onSaved?: (c: Client) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    initialValues: {
      full_name: client?.full_name ?? "",
      phone: client?.phone ?? initialPhone ?? "",
      alt_phone: client?.alt_phone ?? "",
      city: client?.city ?? "",
      address: client?.address ?? "",
      birthday: client?.birthday ?? "",
      anniversary: client?.anniversary ?? "",
      notes: client?.notes ?? "",
    },
    validate: {
      full_name: (v) => (v.trim() ? null : "Enter the name"),
      phone: (v) => (/^\d{7,15}$/.test(digits(v)) ? null : "Enter a valid phone number"),
      alt_phone: (v) => (!v || /^\d{7,15}$/.test(digits(v)) ? null : "Invalid phone"),
    },
  });

  const save = useMutation({
    mutationFn: async (v: typeof form.values) => {
      const row = {
        full_name: v.full_name.trim(), phone: digits(v.phone), alt_phone: v.alt_phone ? digits(v.alt_phone) : null,
        city: v.city || null, address: v.address || null, birthday: v.birthday || null,
        anniversary: v.anniversary || null, notes: v.notes || null,
      };
      return client
        ? (unwrap(await supabase.from("clients").update(row).eq("id", client.id).select().single()) as Client)
        : (unwrap(await supabase.from("clients").insert(row).select().single()) as Client);
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", c.id] });
      onSaved?.(c);
      onClose();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title={client ? "Edit client" : "New client"} size="lg">
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Full name" data-autofocus {...form.getInputProps("full_name")} />
            <TextInput label="Phone" inputMode="tel" placeholder="0300 1234567" {...form.getInputProps("phone")} />
            <TextInput label="Other phone" inputMode="tel" placeholder="optional" {...form.getInputProps("alt_phone")} />
            <TextInput label="City" placeholder="optional" {...form.getInputProps("city")} />
            <TextInput label="Birthday" type="date" {...form.getInputProps("birthday")} />
            <TextInput label="Anniversary" type="date" {...form.getInputProps("anniversary")} />
          </SimpleGrid>
          <TextInput label="Address" placeholder="optional" {...form.getInputProps("address")} />
          <Textarea label="Notes" placeholder="Ring size, preferences…" {...form.getInputProps("notes")} />
          {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>Save client</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
