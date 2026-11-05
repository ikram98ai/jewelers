import {
  ActionIcon, Alert, Badge, Button, Card, Group, Image, Modal, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { num, partLabel, SET_PART_KINDS } from "@/lib/format";
import { uploadPhoto, useSignedUrls } from "@/lib/photos";
import { unwrap } from "@/lib/queries";
import { PHOTO_BUCKET, supabase } from "@/lib/supabase";
import type { ItemComponent } from "@/lib/types";
import { ItemThumb } from "./ItemThumb";
import { Weight } from "./ui";

/** What a set (bridal set etc.) contains: each part with its weight, quantity and photo. */
export function SetContents({ itemId, setGrossWeight, alwaysShow }: { itemId: string; setGrossWeight: number | null; alwaysShow: boolean }) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const parts = useQuery({
    queryKey: ["item-components", itemId],
    queryFn: async () => unwrap(await supabase.from("item_components").select("*").eq("item_id", itemId).order("sort_order")) as ItemComponent[],
  });
  const rows = parts.data ?? [];
  const urls = useSignedUrls(rows.map((r) => r.photo_path).filter(Boolean) as string[]).data ?? {};
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["item-components", itemId] });

  const remove = useMutation({
    mutationFn: async (p: ItemComponent) => {
      unwrap(await supabase.from("item_components").delete().eq("id", p.id));
      if (p.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([p.photo_path]);
    },
    onSuccess: refresh,
    onError: (e) => notifications.show({ color: "red", message: friendlyError(e) }),
  });

  if (!alwaysShow && rows.length === 0) return null;
  const partsWeight = rows.reduce((s, r) => s + Number(r.gross_weight_g ?? 0), 0);
  const gap = setGrossWeight !== null && partsWeight > 0 ? Number(setGrossWeight) - partsWeight : null;

  return (
    <Card>
      <Group justify="space-between" mb="xs">
        <Title order={5}>Set contents {rows.length > 0 && <Badge ml={6} variant="light" color="gold">{rows.reduce((s, r) => s + r.qty, 0)} pieces</Badge>}</Title>
        <Button size="xs" variant="light" color="gold" leftSection={<IconPlus size={14} />} onClick={() => setAddOpen(true)}>Add part</Button>
      </Group>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">List what this set includes, such as the necklace, earrings, bangles and ring, each with its weight and a photo.</Text>
      ) : (
        <Stack gap="xs">
          {rows.map((p) => (
            <Group key={p.id} justify="space-between" wrap="nowrap" align="center">
              <Group gap="sm" wrap="nowrap" miw={0}>
                <ItemThumb url={p.photo_path ? urls[p.photo_path] : null} size={52} />
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600}>{partLabel(p.kind)}{p.qty > 1 ? ` × ${p.qty}` : ""}</Text>
                  {p.description && <Text size="xs" c="dimmed" truncate>{p.description}</Text>}
                </div>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <Weight grams={p.gross_weight_g} size="sm" />
                {isAdmin && (
                  <ActionIcon variant="subtle" color="red" aria-label="Remove part" onClick={() => modals.openConfirmModal({
                    title: `Remove ${partLabel(p.kind).toLowerCase()} from this set?`,
                    labels: { confirm: "Remove", cancel: "Cancel" }, confirmProps: { color: "red" },
                    onConfirm: () => remove.mutate(p),
                  })}><IconTrash size={16} /></ActionIcon>
                )}
              </Group>
            </Group>
          ))}
          {gap !== null && Math.abs(gap) > 0.05 && (
            <Text size="xs" c={Math.abs(gap) > 1 ? "orange" : "dimmed"}>
              Parts add up to {partsWeight.toFixed(3)} g; the set's gross weight is {Number(setGrossWeight).toFixed(3)} g
              ({gap > 0 ? `${gap.toFixed(3)} g not listed` : `${(-gap).toFixed(3)} g over`}).
            </Text>
          )}
        </Stack>
      )}
      {addOpen && <AddPartModal itemId={itemId} nextOrder={rows.length + 1} onClose={() => setAddOpen(false)} onSaved={refresh} />}
    </Card>
  );
}

function AddPartModal({ itemId, nextOrder, onClose, onSaved }: { itemId: string; nextOrder: number; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<string | null>("necklace");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState<number | string>(1);
  const [gross, setGross] = useState<number | string>("");
  const [stone, setStone] = useState<number | string>("");
  const [photo, setPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const save = useMutation({
    mutationFn: async () => {
      const photo_path = photo ? await uploadPhoto(PHOTO_BUCKET, `${itemId}/parts`, photo) : null;
      const { error } = await supabase.from("item_components").insert({
        item_id: itemId, kind: kind!, description: description || null, qty: Number(qty) || 1,
        gross_weight_g: num(gross), stone_weight_g: num(stone) ?? 0, photo_path, sort_order: nextOrder,
      });
      if (error) {
        if (photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([photo_path]);
        throw error;
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
  });

  return (
    <Modal opened onClose={onClose} title="Add a part of this set">
      <Stack>
        <SimpleGrid cols={2}>
          <Select label="Part" data={SET_PART_KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} />
          <NumberInput label="How many" min={1} max={50} allowDecimal={false} value={qty} onChange={setQty} />
          <NumberInput label="Weight (g, all together)" decimalScale={3} min={0} value={gross} onChange={setGross} />
          <NumberInput label="Stone weight (g)" decimalScale={3} min={0} value={stone} onChange={setStone} />
        </SimpleGrid>
        <TextInput label="Description" placeholder="e.g. Kundan necklace with red stones" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
        <Group>
          {preview && <Image src={preview} w={72} h={72} radius="md" fit="cover" alt="" />}
          <Button variant="light" color="gold" leftSection={<IconCamera size={18} />} onClick={() => fileRef.current?.click()}>
            {photo ? "Change photo" : "Add photo"}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { setPhoto(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ""; }} />
        </Group>
        {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!kind} onClick={() => save.mutate()}>Add part</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
