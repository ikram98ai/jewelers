import { Alert, Box, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconDiamond, IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import classes from "./LoginPage.module.css";

export function LoginPage() {
  const { signIn, notice } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { username: "", password: "" },
    validate: {
      username: (v) => (/^[a-zA-Z0-9_.]{3,30}$/.test(v.trim()) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? null : "Enter your username"),
      password: (v) => (v.length >= 8 ? null : "Password is at least 8 characters"),
    },
  });

  const submit = form.onSubmit(async ({ username, password }) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  });

  return (
    <Box className={classes.page}>
      <Paper className={classes.card} p={{ base: "lg", sm: 40 }} shadow="xl">
        <Stack gap="lg">
          <Stack gap={6} align="center">
            <Box className={classes.logo}><IconDiamond size={30} /></Box>
            <Title order={1} fz={28} ta="center">Welcome back</Title>
            <Text c="dimmed" size="sm" ta="center">Sign in with the username your admin gave you.</Text>
          </Stack>

          {notice && <Alert color="orange" icon={<IconInfoCircle />}>{notice}</Alert>}
          {error && <Alert color="red" icon={<IconInfoCircle />}>{error}</Alert>}

          <form onSubmit={submit}>
            <Stack>
              <TextInput
                label="Username or email"
                placeholder="e.g. ali"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-autofocus
                {...form.getInputProps("username")}
              />
              <PasswordInput label="Password" autoComplete="current-password" {...form.getInputProps("password")} />
              <Button type="submit" size="lg" loading={busy} fullWidth mt="xs">Sign in</Button>
            </Stack>
          </form>

          <Text size="xs" c="dimmed" ta="center">Forgot your password? Ask the shop admin to reset it.</Text>
        </Stack>
      </Paper>
    </Box>
  );
}
