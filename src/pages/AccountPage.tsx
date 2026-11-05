import { Alert, Badge, Button, Card, Group, PasswordInput, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { unwrap } from "@/lib/queries";
import { supabase, usernameToEmail } from "@/lib/supabase";

export default function AccountPage() {
  const { profile, refreshProfile } = useAuth();
  const phoneForm = useForm({ initialValues: { phone: profile?.phone ?? "" } });
  const pwForm = useForm({
    initialValues: { current: "", next: "", confirm: "" },
    validate: {
      next: (v) => (v.length >= 8 ? null : "At least 8 characters"),
      confirm: (v, all) => (v === all.next ? null : "Passwords don't match"),
    },
  });

  const savePhone = useMutation({
    mutationFn: async (phone: string) => unwrap(await supabase.from("profiles").update({ phone: phone || null }).eq("id", profile!.id)),
    onSuccess: async () => { await refreshProfile(); notifications.show({ color: "green", message: "Phone saved" }); },
  });

  const changePassword = useMutation({
    mutationFn: async (v: typeof pwForm.values) => {
      // Re-check the current password before changing it.
      const { data: me } = await supabase.auth.getUser();
      const email = me.user?.email ?? usernameToEmail(profile!.username);
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: v.current });
      if (authErr) throw new Error("Current password is wrong");
      const { error } = await supabase.auth.updateUser({ password: v.next });
      if (error) throw error;
    },
    onSuccess: () => { pwForm.reset(); notifications.show({ color: "green", message: "Password changed" }); },
  });

  if (!profile) return null;
  return (
    <>
      <PageHeader title="My account" subtitle={<>@{profile.username} <Badge ml="xs" color={profile.role === "admin" ? "gold" : "ink"}>{profile.role}</Badge></>} />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Card>
          <Title order={4} mb="md">Contact</Title>
          <form onSubmit={phoneForm.onSubmit((v) => savePhone.mutate(v.phone))}>
            <Stack>
              <TextInput label="Name" value={profile.full_name} disabled description="Ask an admin to change your name." />
              <TextInput label="Phone" inputMode="tel" {...phoneForm.getInputProps("phone")} />
              {savePhone.error && <Alert color="red">{friendlyError(savePhone.error)}</Alert>}
              <Group justify="flex-end"><Button type="submit" loading={savePhone.isPending}>Save</Button></Group>
            </Stack>
          </form>
        </Card>
        <Card>
          <Title order={4} mb="md">Change password</Title>
          <form onSubmit={pwForm.onSubmit((v) => changePassword.mutate(v))}>
            <Stack>
              <PasswordInput label="Current password" autoComplete="current-password" {...pwForm.getInputProps("current")} />
              <PasswordInput label="New password" autoComplete="new-password" {...pwForm.getInputProps("next")} />
              <PasswordInput label="Repeat new password" autoComplete="new-password" {...pwForm.getInputProps("confirm")} />
              {changePassword.error && <Alert color="red">{friendlyError(changePassword.error)}</Alert>}
              <Text size="xs" c="dimmed">Use something you can remember. Don't share it with other staff.</Text>
              <Group justify="flex-end"><Button type="submit" loading={changePassword.isPending}>Change password</Button></Group>
            </Stack>
          </form>
        </Card>
      </SimpleGrid>
    </>
  );
}
