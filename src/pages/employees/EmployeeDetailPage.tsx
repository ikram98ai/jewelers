import {
  Alert, Badge, Button, Card, Grid, Group, Modal, NumberInput, PasswordInput, Select, SimpleGrid, Stack, Table, Text,
  TextInput, Textarea, Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconKey, IconPlus, IconUserCheck, IconUserOff } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { EmptyState, ErrorText, Loading, Money, PageHeader, StatCard } from "@/components/ui";
import { adminUsers, suggestPassword } from "@/lib/adminUsers";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { num, phoneDisplay, shortDate } from "@/lib/format";
import { unwrap } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { EmployeeHr, Profile, SalaryPayment } from "@/lib/types";

const PAY_TYPES = [
  { value: "salary", label: "Salary" }, { value: "advance", label: "Advance" },
  { value: "bonus", label: "Bonus" }, { value: "deduction", label: "Deduction" },
];

export default function EmployeeDetailPage() {
  const { id = "" } = useParams();
  const { isAdmin, profile: me } = useAuth();
  const queryClient = useQueryClient();
  const [pwOpen, pw] = useDisclosure(false);
  const [payOpen, pay] = useDisclosure(false);

  const profile = useQuery({
    queryKey: ["employee", id],
    queryFn: async () => unwrap(await supabase.from("profiles").select("*").eq("id", id).single()) as Profile,
  });
  const hr = useQuery({
    queryKey: ["employee", id, "hr"], enabled: isAdmin,
    queryFn: async () => unwrap(await supabase.from("employee_hr").select("*").eq("profile_id", id).maybeSingle()) as EmployeeHr | null,
  });
  const salary = useQuery({
    queryKey: ["employee", id, "salary"], enabled: isAdmin,
    queryFn: async () => unwrap(await supabase.from("salary_payments").select("*").eq("profile_id", id).order("paid_on", { ascending: false }).limit(100)) as SalaryPayment[],
  });
  const monthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })();
  const perf = useQuery({
    queryKey: ["employee", id, "perf", monthStart], enabled: isAdmin,
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc("employee_performance", { p_from: monthStart, p_to: new Date().toISOString().slice(0, 10) })) as
        { profile_id: string; sales_count: number; sales_total: number; discount_total: number }[];
      return rows.find((r) => r.profile_id === id) ?? null;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["employee", id] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  };

  const update = useMutation({
    mutationFn: adminUsers.update,
    onSuccess: () => { notifications.show({ color: "green", message: "Account updated" }); refresh(); },
    onError: (e) => notifications.show({ color: "red", message: (e as Error).message }),
  });

  if (!isAdmin) return <EmptyState title="Admins only" />;
  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorText error={profile.error ?? "Not found"} />;
  const p = profile.data;
  const isMe = p.id === me?.id;

  const monthPayments = (salary.data ?? []).filter((s) => s.paid_on >= monthStart);
  const sumType = (list: SalaryPayment[], t: string) => list.filter((s) => s.type === t).reduce((a, s) => a + Number(s.amount), 0);
  const paidThisMonth = sumType(monthPayments, "salary") + sumType(monthPayments, "advance") + sumType(monthPayments, "bonus") - sumType(monthPayments, "deduction");

  return (
    <>
      <PageHeader
        title={p.full_name}
        subtitle={<>@{p.username} · {phoneDisplay(p.phone)} <Badge ml="xs" color={p.role === "admin" ? "gold" : "ink"}>{p.role}</Badge>{!p.active && <Badge ml="xs" color="gray">inactive</Badge>}</>}
        actions={
          <>
            <Button variant="default" leftSection={<IconKey size={18} />} onClick={pw.open} disabled={!p.active}>Reset password</Button>
            {!isMe && (
              p.active ? (
                <Button variant="light" color="red" leftSection={<IconUserOff size={18} />} loading={update.isPending}
                  onClick={() => modals.openConfirmModal({
                    title: `Deactivate ${p.full_name}?`,
                    children: <Text size="sm">They will be signed out and cannot log in. All their sales and history are kept. You can reactivate them later.</Text>,
                    labels: { confirm: "Deactivate", cancel: "Cancel" }, confirmProps: { color: "red" },
                    onConfirm: () => update.mutate({ user_id: p.id, active: false }),
                  })}>Deactivate</Button>
              ) : (
                <Button variant="light" color="green" leftSection={<IconUserCheck size={18} />} loading={update.isPending}
                  onClick={() => update.mutate({ user_id: p.id, active: true })}>Reactivate</Button>
              )
            )}
          </>
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 3 }} mb="lg" spacing={{ base: "xs", sm: "md" }}>
        <StatCard label="Sales this month" value={perf.data?.sales_count ?? 0} hint={<Money value={perf.data?.sales_total ?? 0} size="xs" />} />
        <StatCard label="Discounts given this month" value={<Money value={perf.data?.discount_total ?? 0} fw={700} />} />
        <StatCard label="Paid this month" value={<Money value={paidThisMonth} fw={700} />} hint={hr.data?.monthly_salary ? <>Salary <Money value={hr.data.monthly_salary} size="xs" /></> : undefined} />
      </SimpleGrid>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack>
            <Card>
              <Title order={5} mb="sm">Account</Title>
              <Select label="Role" data={[{ value: "staff", label: "Staff" }, { value: "admin", label: "Admin" }]} value={p.role} disabled={isMe || !p.active}
                description={isMe ? "You can't change your own role." : undefined}
                onChange={(r) => r && r !== p.role && modals.openConfirmModal({
                  title: `Make ${p.full_name} ${r === "admin" ? "an admin" : "staff"}?`,
                  children: <Text size="sm">{r === "admin" ? "Admins see costs, profit, salaries and can void sales and manage users." : "They will lose access to admin screens."}</Text>,
                  labels: { confirm: "Change role", cancel: "Cancel" },
                  onConfirm: () => update.mutate({ user_id: p.id, role: r as "admin" | "staff" }),
                })} />
            </Card>
            {hr.isFetched && <HrCard profile={p} hr={hr.data ?? null} onSaved={refresh} />}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card>
            <Group justify="space-between" mb="sm" gap="xs">
              <Title order={5}>Salary & advances</Title>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={pay.open}>Record payment</Button>
            </Group>
            {(salary.data ?? []).length === 0 ? <Text c="dimmed" size="sm">Nothing recorded yet.</Text> : (
              <Table verticalSpacing={6}>
                <Table.Tbody>
                  {salary.data!.map((s) => (
                    <Table.Tr key={s.id}>
                      <Table.Td><Text size="sm">{shortDate(s.paid_on)}</Text>{s.note && <Text size="xs" c="dimmed" hiddenFrom="sm">{s.note}</Text>}</Table.Td>
                      <Table.Td><Badge color={s.type === "deduction" ? "red" : s.type === "advance" ? "orange" : "green"}>{s.type}</Badge></Table.Td>
                      <Table.Td visibleFrom="sm"><Text size="xs" c="dimmed">{s.note}</Text></Table.Td>
                      <Table.Td ta="right"><Money value={s.type === "deduction" ? -s.amount : s.amount} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      {pwOpen && <ResetPasswordModal profile={p} onClose={pw.close} />}
      {payOpen && <SalaryModal profileId={p.id} onClose={pay.close} onSaved={() => queryClient.invalidateQueries({ queryKey: ["employee", id, "salary"] })} />}
    </>
  );
}

function HrCard({ profile, hr, onSaved }: { profile: Profile; hr: EmployeeHr | null; onSaved: () => void }) {
  const form = useForm({
    initialValues: {
      full_name: profile.full_name, phone: profile.phone ?? "",
      joined_on: hr?.joined_on ?? "", left_on: hr?.left_on ?? "", monthly_salary: (hr?.monthly_salary ?? "") as number | string,
      national_id: hr?.national_id ?? "", address: hr?.address ?? "", emergency_contact: hr?.emergency_contact ?? "", notes: hr?.notes ?? "",
    },
  });
  const save = useMutation({
    mutationFn: async (v: typeof form.values) => {
      unwrap(await supabase.from("profiles").update({ full_name: v.full_name.trim(), phone: v.phone || null }).eq("id", profile.id));
      unwrap(await supabase.from("employee_hr").upsert({
        profile_id: profile.id, joined_on: v.joined_on || null, left_on: v.left_on || null, monthly_salary: num(v.monthly_salary),
        national_id: v.national_id || null, address: v.address || null, emergency_contact: v.emergency_contact || null, notes: v.notes || null,
      }));
    },
    onSuccess: () => { notifications.show({ color: "green", message: "Saved" }); onSaved(); },
  });
  return (
    <Card>
      <Title order={5} mb="sm">Employee record <Text span size="xs" c="dimmed">(admin only)</Text></Title>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput label="Full name" {...form.getInputProps("full_name")} />
            <TextInput label="Phone" {...form.getInputProps("phone")} />
            <TextInput label="Joined on" type="date" {...form.getInputProps("joined_on")} />
            <TextInput label="Left on" type="date" {...form.getInputProps("left_on")} />
            <NumberInput label="Monthly salary" thousandSeparator="," min={0} {...form.getInputProps("monthly_salary")} />
            <TextInput label="National ID" {...form.getInputProps("national_id")} />
          </SimpleGrid>
          <TextInput label="Emergency contact" {...form.getInputProps("emergency_contact")} />
          <Textarea label="Address" {...form.getInputProps("address")} />
          <Textarea label="Notes" {...form.getInputProps("notes")} />
          {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
          <Group justify="flex-end"><Button type="submit" loading={save.isPending}>Save</Button></Group>
        </Stack>
      </form>
    </Card>
  );
}

function ResetPasswordModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [password, setPassword] = useState(suggestPassword());
  const reset = useMutation({
    mutationFn: () => adminUsers.resetPassword(profile.id, password),
    onSuccess: () => { notifications.show({ color: "green", message: `New password set for @${profile.username}` }); onClose(); },
  });
  return (
    <Modal opened onClose={onClose} title={`Reset password for ${profile.full_name}`}>
      <Stack>
        <PasswordInput label="New password" visible onVisibilityChange={() => undefined} value={password} onChange={(e) => setPassword(e.currentTarget.value)}
          description="Tell them in person. They can change it under My account." />
        {reset.error && <Alert color="red">{(reset.error as Error).message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={password.length < 8} loading={reset.isPending} onClick={() => reset.mutate()}>Set password</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function SalaryModal({ profileId, onClose, onSaved }: { profileId: string; onClose: () => void; onSaved: () => void }) {
  const form = useForm({
    initialValues: { paid_on: new Date().toISOString().slice(0, 10), type: "salary", amount: "" as number | string, note: "" },
    validate: { amount: (v) => (Number(v) > 0 ? null : "Enter an amount") },
  });
  const save = useMutation({
    mutationFn: async (v: typeof form.values) => unwrap(await supabase.from("salary_payments").insert({
      profile_id: profileId, paid_on: v.paid_on, type: v.type, amount: Number(v.amount), note: v.note || null,
    })),
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <Modal opened onClose={onClose} title="Record salary payment">
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <SimpleGrid cols={2}>
            <TextInput label="Date" type="date" {...form.getInputProps("paid_on")} />
            <Select label="Type" data={PAY_TYPES} {...form.getInputProps("type")} />
          </SimpleGrid>
          <NumberInput label="Amount" thousandSeparator="," min={0} {...form.getInputProps("amount")} />
          <TextInput label="Note" placeholder="e.g. October salary" {...form.getInputProps("note")} />
          <Text size="xs" c="dimmed">Entries can't be edited later. Record a deduction to correct a mistake.</Text>
          {save.error && <Alert color="red">{friendlyError(save.error)}</Alert>}
          <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}
