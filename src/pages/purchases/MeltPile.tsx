import { Alert, Badge, Button, Card, Group, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFlame } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorText, StatCard } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { dateTime, money, num } from "@/lib/format";
import { unwrap, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

type Pile = { metal: string; purity: string; weight_g: number; value: number };
type Batch = {
  id: string; batch_no: string; metal: string; purity: string; weight_g: number; cost_value: number; outcome: string;
  result_weight_g: number | null; sold_amount: number | null; note: string | null; created_at: string;
  voided_at: string | null; void_reason: string | null;
};

const pileLabel = (p: { metal: string; purity: string }) => (p.purity === "—" ? p.metal : `${p.purity} ${p.metal}`);
const grams = (g: number | string) => `${Number(g).toFixed(2)} g`;

/** What is waiting to be melted, recording metal leaving the pile, and the record of what has left. */
export function MeltPile() {
  const { fmt } = useSettings();
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<Batch | null>(null);
  const pile = useQuery({
    queryKey: ["melt-pool"],
    queryFn: async () => unwrap(await supabase.rpc("melt_pool_summary")) as unknown as Pile[],
  });
  const batches = useQuery({
    queryKey: ["melt-batches"],
    queryFn: async () => unwrap(await supabase.from("melt_batches")
      .select("id, batch_no, metal, purity, weight_g, cost_value, outcome, result_weight_g, sold_amount, note, created_at, voided_at, void_reason")
      .order("created_at", { ascending: false }).limit(20)) as unknown as Batch[],
  });
  const refresh = () => ["melt-pool", "melt-batches"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  const piles = pile.data ?? [];

  return (
    <>
      <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
        <Text size="sm" fw={600}>Melt pile: old metal taken in on sales or bought for melting</Text>
        <Button size="xs" variant="default" disabled={piles.length === 0} onClick={() => setRecording(true)}>Record melted or sold</Button>
      </Group>
      <ErrorText error={pile.error} />
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="lg">
        {piles.length === 0 ? <StatCard label="Melt pile" value="Empty" icon={<IconFlame size={22} />} accent="orange" /> :
          piles.map((m) => (
            <StatCard key={`${m.metal}${m.purity}`} label={pileLabel(m)} value={grams(m.weight_g)} hint={`paid ${money(m.value, fmt)}`}
              icon={<IconFlame size={22} />} accent="orange" />
          ))}
      </SimpleGrid>

      <ErrorText error={batches.error} />
      {(batches.data ?? []).length > 0 && (
        <Card mb="lg">
          <Title order={4} mb="sm">Melted or sold</Title>
          <Stack gap="sm">
            {batches.data!.map((b) => (
              <Group key={b.id} justify="space-between" wrap="wrap" gap="xs" opacity={b.voided_at ? 0.6 : 1}>
                <div>
                  <Group gap="xs">
                    <Text size="sm" fw={600}>{b.batch_no}</Text>
                    <Text size="xs" c="dimmed">{dateTime(b.created_at)}</Text>
                    {b.voided_at && <Badge size="sm" color="red" variant="light">Void</Badge>}
                  </Group>
                  <Text size="sm">
                    {pileLabel(b)}: {b.outcome === "melted"
                      ? `melted ${grams(b.weight_g)} → ${grams(b.result_weight_g!)} (lost ${grams(Number(b.weight_g) - Number(b.result_weight_g))})`
                      : `sold ${grams(b.weight_g)} for ${money(b.sold_amount, fmt)} (paid ${money(b.cost_value, fmt)})`}
                  </Text>
                  {b.note && <Text size="xs" c="dimmed">{b.note}</Text>}
                  {b.void_reason && <Text size="xs" c="red">Voided: {b.void_reason}</Text>}
                </div>
                {!b.voided_at && <Button size="xs" variant="subtle" color="red" onClick={() => setVoiding(b)}>Void</Button>}
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      {recording && <RecordModal piles={piles} onClose={() => setRecording(false)} onSaved={refresh} />}
      {voiding && <VoidModal batch={voiding} onClose={() => setVoiding(null)} onSaved={refresh} />}
    </>
  );
}

function RecordModal({ piles, onClose, onSaved }: { piles: Pile[]; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState<string | null>(piles.length === 1 ? `${piles[0].metal}|${piles[0].purity}` : null);
  const chosen = piles.find((p) => `${p.metal}|${p.purity}` === key);
  const [weight, setWeight] = useState<number | string>(piles.length === 1 ? Number(piles[0].weight_g) : "");
  const [outcome, setOutcome] = useState("melted");
  const [result, setResult] = useState<number | string>("");
  const [amount, setAmount] = useState<number | string>("");
  const [note, setNote] = useState("");

  const w = num(weight);
  const r = num(result);
  const problem =
    !chosen ? "Choose what left the pile." :
    !(w! > 0) ? "Enter the weight taken." :
    w! > Number(chosen.weight_g) ? `Only ${chosen.weight_g} g is on the pile.` :
    outcome === "melted" && !(r! > 0) ? "Enter the weight after melting." :
    outcome === "melted" && r! > w! ? "The weight after melting can't be more than the weight melted." :
    outcome === "sold" && !(num(amount)! > 0) ? "Enter the amount received." : null;

  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("record_melt", {
      p_metal: chosen!.metal, p_purity: chosen!.purity, p_weight_g: w!, p_outcome: outcome,
      p_result_weight_g: outcome === "melted" ? r! : undefined,
      p_sold_amount: outcome === "sold" ? num(amount)! : undefined,
      p_note: note || undefined,
    })),
    onSuccess: () => { notifications.show({ color: "green", message: "Melt pile updated" }); onSaved(); onClose(); },
  });

  return (
    <Modal opened onClose={onClose} title="Record melted or sold">
      <Stack>
        <Select label="From the pile" placeholder="Choose" value={key}
          data={piles.map((p) => ({ value: `${p.metal}|${p.purity}`, label: `${pileLabel(p)}: ${grams(p.weight_g)}` }))}
          onChange={(k) => { setKey(k); const p = piles.find((x) => `${x.metal}|${x.purity}` === k); if (p) setWeight(Number(p.weight_g)); }} />
        <SegmentedControl value={outcome} onChange={setOutcome}
          data={[{ value: "melted", label: "Melted" }, { value: "sold", label: "Sold to refiner or dealer" }]} />
        <NumberInput label="Weight taken (g)" decimalScale={3} min={0} value={weight} onChange={setWeight} />
        {outcome === "melted" ? (
          <NumberInput label="Weight after melting (g)" decimalScale={3} min={0} value={result} onChange={setResult}
            description={w! > 0 && r! > 0 && r! <= w! ? `Lost ${(w! - r!).toFixed(3)} g (${(((w! - r!) / w!) * 100).toFixed(2)}%)` : undefined} />
        ) : (
          <NumberInput label="Amount received" thousandSeparator="," min={0} value={amount} onChange={setAmount} />
        )}
        <Textarea label="Note" placeholder="e.g. who melted it, tested purity afterwards" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        {problem && <Alert color="orange" p="xs"><Text size="xs">{problem}</Text></Alert>}
        {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
        <Button color="gold" disabled={!!problem} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </Stack>
    </Modal>
  );
}

function VoidModal({ batch, onClose, onSaved }: { batch: Batch; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("void_melt_batch", { p_id: batch.id, p_reason: reason })),
    onSuccess: () => { notifications.show({ color: "green", message: `${batch.batch_no} voided, weight back on the pile` }); onSaved(); onClose(); },
  });
  return (
    <Modal opened onClose={onClose} title={`Void ${batch.batch_no}`}>
      <Stack>
        <Text size="sm">{grams(batch.weight_g)} of {pileLabel(batch)} goes back on the melt pile.</Text>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
        <Button color="red" disabled={!reason.trim()} loading={save.isPending} onClick={() => save.mutate()}>Void</Button>
      </Stack>
    </Modal>
  );
}
