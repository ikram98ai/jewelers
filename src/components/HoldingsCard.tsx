import { Anchor, Badge, Card, Group, Text } from "@mantine/core";
import { IconFlame, IconShieldLock } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { unwrap } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

/** Gold held for clients (safekeeping) and, for admins, the melt pile. */
export function HoldingsCard() {
  const { isAdmin } = useAuth();
  const held = useQuery({
    queryKey: ["custody", "summary"],
    queryFn: async () => unwrap(await supabase.rpc("custody_summary")) as unknown as
      { receipts_held: number; by_purity: { metal: string; purity: string; weight_g: number }[] },
  });
  const melt = useQuery({
    queryKey: ["melt-pool"],
    enabled: isAdmin,
    queryFn: async () => unwrap(await supabase.rpc("melt_pool_summary")) as unknown as { metal: string; purity: string; weight_g: number }[],
  });
  return (
    <Card>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="xs" wrap="wrap">
          <IconShieldLock size={20} color="var(--mantine-color-gold-7)" />
          <Anchor component={Link} to="/safekeeping" fw={600} c="dark">Held for clients</Anchor>
          <Text size="sm" c="dimmed">{held.data?.receipts_held ?? 0} receipts</Text>
          {(held.data?.by_purity ?? []).map((p) => (
            <Badge key={`${p.metal}${p.purity}`} variant="light" color="gold">{p.purity} {p.metal}: {Number(p.weight_g).toFixed(2)} g</Badge>
          ))}
        </Group>
        {isAdmin && (melt.data?.length ?? 0) > 0 && (
          <Group gap="xs" wrap="wrap">
            <IconFlame size={20} color="var(--mantine-color-orange-6)" />
            <Anchor component={Link} to="/purchases" fw={600} c="dark">Melt pile</Anchor>
            {melt.data!.map((m) => <Badge key={`${m.metal}${m.purity}`} variant="light" color="orange">{m.purity === "—" ? m.metal : `${m.purity} ${m.metal}`}: {Number(m.weight_g).toFixed(2)} g</Badge>)}
          </Group>
        )}
      </Group>
    </Card>
  );
}
