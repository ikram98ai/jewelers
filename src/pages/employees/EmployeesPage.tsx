import {
  ActionIcon, Alert, Avatar, Badge, Button, Card, CopyButton, Group, Modal, NumberInput, PasswordInput, SegmentedControl,
  SimpleGrid, Stack, Table, Text, TextInput, Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconCopy, IconRefresh, IconUserPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ErrorText, Loading, PageHeader } from "@/components/ui";
import { adminUsers, suggestPassword } from "@/lib/adminUsers";
import { useAuth } from "@/lib/auth";
import { phoneDisplay } from "@/lib/format";
import { unwrap } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

export default function EmployeesPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [addOpen, add] = useDisclosure(false);
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () => unwrap(await supabase.from("profiles").select("*").order("active", { ascending: false }).order("full_name")) as Profile[],
  });

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Everyone who can sign in to the app"
        actions={isAdmin && <Button leftSection={<IconUserPlus size={18} />} onClick={add.open}>Add employee</Button>}
      />
      <ErrorText error={employees.error} />
      {employees.isLoading ? <Loading /> : (
        <Card padding={0}>
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Tbody>
              {(employees.data ?? []).map((e) => (
                <Table.Tr key={e.id} data-clickable={isAdmin || undefined} onClick={() => isAdmin && navigate(`/employees/${e.id}`)} opacity={e.active ? 1 : 0.55}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <Avatar color={e.role === "admin" ? "gold" : "ink"} radius="xl">{e.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</Avatar>
                      <div><Text fw={600} size="sm">{e.full_name}</Text><Text size="xs" c="dimmed">@{e.username}</Text></div>
                    </Group>
                  </Table.Td>
                  <Table.Td visibleFrom="xs"><Text size="sm" ff="monospace">{phoneDisplay(e.phone)}</Text></Table.Td>
                  <Table.Td ta="right">
                    <Group gap={6} justify="flex-end">
                      <Badge color={e.role === "admin" ? "gold" : "ink"}>{e.role}</Badge>
                      {!e.active && <Badge color="gray">inactive</Badge>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
      {addOpen && <AddEmployeeModal onClose={add.close} />}
    </>
  );
}

function AddEmployeeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm({
    initialValues: {
      full_name: "", username: "", role: "staff" as "staff" | "admin", phone: "", password: suggestPassword(),
      joined_on: new Date().toISOString().slice(0, 10), monthly_salary: "" as number | string,
    },
    validate: {
      full_name: (v) => (v.trim() ? null : "Enter the name"),
      username: (v) => (/^[a-z0-9_.]{3,30}$/.test(v) ? null : "3–30 lowercase letters, digits, . or _"),
      password: (v) => (v.length >= 8 ? null : "At least 8 characters"),
    },
  });
  const create = useMutation({
    mutationFn: (v: typeof form.values) => adminUsers.create({
      username: v.username, full_name: v.full_name.trim(), role: v.role, password: v.password, phone: v.phone || undefined,
      hr: { joined_on: v.joined_on || undefined, monthly_salary: v.monthly_salary === "" ? null : Number(v.monthly_salary) },
    }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      notifications.show({ color: "green", title: "Employee added", message: `They can sign in as “${r.username}”. Give them the password in person.` });
      onClose();
      navigate(`/employees/${r.user_id}`);
    },
  });

  return (
    <Modal opened onClose={onClose} title="Add employee" size="lg">
      <form onSubmit={form.onSubmit((v) => create.mutate(v))}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Full name" data-autofocus {...form.getInputProps("full_name")}
              onBlur={() => {
                if (!form.values.username && form.values.full_name) {
                  form.setFieldValue("username", form.values.full_name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9_.]/g, ""));
                }
              }} />
            <TextInput label="Username (for login)" autoCapitalize="none" {...form.getInputProps("username")}
              onChange={(e) => form.setFieldValue("username", e.currentTarget.value.toLowerCase())} />
            <TextInput label="Phone" inputMode="tel" {...form.getInputProps("phone")} />
            <div>
              <Text size="sm" fw={500} mb={4}>Role</Text>
              <SegmentedControl fullWidth data={[{ value: "staff", label: "Staff" }, { value: "admin", label: "Admin" }]} {...form.getInputProps("role")} />
            </div>
            <TextInput label="Joined on" type="date" {...form.getInputProps("joined_on")} />
            <NumberInput label="Monthly salary (admin only)" thousandSeparator="," min={0} {...form.getInputProps("monthly_salary")} />
          </SimpleGrid>
          <PasswordInput label="Starting password" description="Give this to the employee in person. They can change it under My account."
            visible onVisibilityChange={() => undefined}
            rightSection={
              <Group gap={2} wrap="nowrap">
                <Tooltip label="New password"><ActionIcon variant="subtle" onClick={() => form.setFieldValue("password", suggestPassword())}><IconRefresh size={16} /></ActionIcon></Tooltip>
                <CopyButton value={form.values.password}>{({ copied, copy }) => (
                  <ActionIcon variant="subtle" color={copied ? "green" : undefined} onClick={copy}>{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}</ActionIcon>
                )}</CopyButton>
              </Group>
            }
            rightSectionWidth={64}
            {...form.getInputProps("password")} />
          {form.values.role === "admin" && <Alert color="gold">Admins see costs, profits, salaries and the audit log, and can void sales and manage users.</Alert>}
          {create.error && <Alert color="red">{(create.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create account</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
