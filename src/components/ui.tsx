import {
  Badge, Box, Card, Center, Group, Loader, Stack, Text, ThemeIcon, Title, type BadgeProps,
} from "@mantine/core";
import { IconMoodEmpty } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { friendlyError } from "@/lib/errors";
import { money, weight as fmtWeight } from "@/lib/format";
import { useSettings } from "@/lib/queries";

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" wrap="wrap" gap="sm">
      <Box miw={0} maw="100%">
        <Title order={2} fz={{ base: 24, sm: 30 }} style={{ overflowWrap: "anywhere" }}>{title}</Title>
        {subtitle && <Text c="dimmed" size="sm" mt={4}>{subtitle}</Text>}
      </Box>
      {/* On phones the actions take their own full-width row of big buttons. */}
      {actions && <Group gap="sm" className="mobile-fill">{actions}</Group>}
    </Group>
  );
}

export function Money({ value, size, fw, c }: { value: number | string | null | undefined; size?: string; fw?: number; c?: string }) {
  const { fmt } = useSettings();
  return <Text component="span" ff="monospace" size={size} fw={fw} c={c} style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(value, fmt)}</Text>;
}

export function Weight({ grams, size }: { grams: number | string | null | undefined; size?: string }) {
  const { unit } = useSettings();
  return <Text component="span" ff="monospace" size={size} style={{ fontVariantNumeric: "tabular-nums" }}>{fmtWeight(grams, unit)}</Text>;
}

export function StatCard({ label, value, hint, icon, accent = "ink" }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; accent?: string;
}) {
  return (
    <Card p={{ base: "sm", sm: "md" }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Stack gap={4} miw={0}>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" lts={0.5}>{label}</Text>
          {/* Large amounts must fit a half-width phone card, so shrink and allow wrapping. */}
          <Text fz={{ base: 18, sm: 24 }} fw={700} lh={1.2} style={{ overflowWrap: "anywhere" }}>{value}</Text>
          {hint && <Text size="xs" c="dimmed">{hint}</Text>}
        </Stack>
        {icon && <ThemeIcon size={40} radius="md" variant="light" color={accent} visibleFrom="sm">{icon}</ThemeIcon>}
      </Group>
    </Card>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <Center py="xl">
      <Group gap="sm"><Loader size="sm" /><Text c="dimmed">{label}</Text></Group>
    </Center>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <Text c="red" size="sm">{friendlyError(error)}</Text>;
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <Center py={48}>
      <Stack align="center" gap="xs" maw={360} ta="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="gold">{icon ?? <IconMoodEmpty size={28} />}</ThemeIcon>
        <Text fw={600}>{title}</Text>
        {children && <Text size="sm" c="dimmed">{children}</Text>}
      </Stack>
    </Center>
  );
}

const STATUS: Record<string, { label: string; color: string }> = {
  in_stock: { label: "In stock", color: "green" },
  sold: { label: "Sold", color: "gray" },
  written_off: { label: "Written off", color: "red" },
  completed: { label: "Completed", color: "green" },
  void: { label: "Void", color: "red" },
};

export function StatusBadge({ status, ...rest }: { status: string } & BadgeProps) {
  const s = STATUS[status] ?? { label: status, color: "gray" };
  return <Badge color={s.color} {...rest}>{s.label}</Badge>;
}

export function PurityBadge({ metal, purity }: { metal: string; purity: string | null }) {
  if (!purity) return <Badge color="gray">{metal}</Badge>;
  return <Badge color={metal === "gold" ? "gold" : "gray"} variant={metal === "gold" ? "light" : "outline"}>{purity} {metal}</Badge>;
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md" py={6} style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Box ta="right">{typeof children === "string" ? <Text size="sm">{children}</Text> : children}</Box>
    </Group>
  );
}
