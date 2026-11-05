import {
  Alert, AppShell, Avatar, Box, Button, Drawer, Group, Menu, NavLink, Stack, Text, UnstyledButton,
} from "@mantine/core";
import { useDisclosure, useNetwork } from "@mantine/hooks";
import {
  IconAlertTriangle, IconBuildingBank, IconBuildingStore, IconChartBar, IconCoins, IconDiamond, IconDots, IconHistory,
  IconHome, IconLogout, IconReceipt, IconSettings, IconShieldLock, IconShoppingBag, IconUser, IconUsers, IconWifiOff,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { NavLink as RouterLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useRates, useSettings } from "@/lib/queries";
import { useIsMobile } from "@/lib/useIsMobile";
import classes from "./AppLayout.module.css";

interface NavItem { to: string; label: string; icon: ReactNode; admin?: boolean }

const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: <IconHome size={20} /> },
  { to: "/sell", label: "New sale", icon: <IconShoppingBag size={20} /> },
  { to: "/stock", label: "Stock", icon: <IconDiamond size={20} /> },
  { to: "/clients", label: "Clients", icon: <IconUsers size={20} /> },
  { to: "/sales", label: "Sales", icon: <IconReceipt size={20} /> },
  { to: "/safekeeping", label: "Safekeeping", icon: <IconShieldLock size={20} /> },
  { to: "/purchases", label: "Bought from clients", icon: <IconBuildingBank size={20} />, admin: true },
  { to: "/rates", label: "Metal rates", icon: <IconCoins size={20} /> },
  { to: "/employees", label: "Employees", icon: <IconUser size={20} /> },
  { to: "/settings", label: "Settings", icon: <IconSettings size={20} />, admin: true },
  { to: "/audit", label: "Audit log", icon: <IconHistory size={20} />, admin: true },
];
const MOBILE_TABS = ["/", "/sell", "/stock", "/clients"];

function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

export function AppLayout() {
  const { profile, isAdmin, signOut } = useAuth();
  const { settings } = useSettings();
  const rates = useRates();
  const network = useNetwork();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, more] = useDisclosure(false);
  const isMobile = useIsMobile();

  const items = NAV.filter((n) => !n.admin || isAdmin);

  const navLinks = (onClick?: () => void) => items.map((n) => (
    <NavLink
      key={n.to}
      component={RouterLink}
      to={n.to}
      label={n.label}
      leftSection={n.icon}
      active={isActive(pathname, n.to)}
      onClick={onClick}
      className={classes.navLink}
    />
  ));

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 248, breakpoint: "sm", collapsed: { mobile: true } }}
      // The tab bar exists only on phones; collapsing it elsewhere also drops
      // the bottom padding Mantine reserves for it.
      footer={{ height: 64, collapsed: !isMobile }}
      padding={{ base: "md", sm: "xl" }}
      classNames={{ footer: classes.footer }}
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <UnstyledButton onClick={() => navigate("/")} className={classes.brand}>
              <IconDiamond size={22} color="var(--mantine-color-gold-4)" />
              <Text fw={600} ff="heading" fz="lg" c="white" truncate maw={{ base: "52vw", sm: 320 }}>{settings?.shop_name ?? "Jewelers"}</Text>
            </UnstyledButton>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <RateChip />
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <UnstyledButton aria-label="Account menu">
                  <Avatar color="gold" radius="xl" size={36}>{initials(profile?.full_name)}</Avatar>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  {profile?.full_name}
                  <Text size="xs" c="dimmed">@{profile?.username} · {profile?.role}</Text>
                </Menu.Label>
                <Menu.Item leftSection={<IconUser size={16} />} onClick={() => navigate("/account")}>My account</Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => signOut()}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" className={classes.navbar}>
        <AppShell.Section grow>
          <Stack gap={2}>{navLinks()}</Stack>
        </AppShell.Section>
        <AppShell.Section>
          <Text size="xs" c="dimmed" px="sm">Signed in as @{profile?.username}</Text>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>
        {!network.online && (
          <Alert color="red" icon={<IconWifiOff />} mb="md" title="No connection">
            Changes cannot be saved until the internet is back. Note sales on paper and enter them later.
          </Alert>
        )}
        {rates.isSuccess && !rates.setToday && (
          <Alert color="gold" icon={<IconAlertTriangle />} mb="md" variant="light">
            <Group justify="space-between" gap="sm" wrap="wrap">
              <Text size="sm" flex="1 1 200px">
                {rates.data.length === 0
                  ? "No metal rates set yet. Prices can't be calculated."
                  : `Today's rates are not set. Prices use the rate from ${rates.data[0]?.effective_on}.`}
              </Text>
              {isAdmin && <Button size="xs" color="gold" onClick={() => navigate("/rates")}>Set today's rates</Button>}
            </Group>
          </Alert>
        )}
        <Box maw={1200} mx="auto"><Outlet /></Box>
      </AppShell.Main>

      <AppShell.Footer hiddenFrom="sm">
        <Group grow h="100%" gap={0} px={4}>
          {MOBILE_TABS.map((to) => {
            const n = NAV.find((x) => x.to === to)!;
            return (
              <UnstyledButton key={to} onClick={() => navigate(to)} className={classes.tab} data-active={isActive(pathname, to) || undefined}>
                {n.icon}
                <span>{n.label === "New sale" ? "Sell" : n.label}</span>
              </UnstyledButton>
            );
          })}
          <UnstyledButton onClick={more.open} className={classes.tab}>
            <IconDots size={20} />
            <span>More</span>
          </UnstyledButton>
        </Group>
      </AppShell.Footer>

      <Drawer
        opened={moreOpen} onClose={more.close} position="bottom" size="auto" title="Menu" radius="lg"
        styles={{ content: { maxHeight: "85dvh", paddingBottom: "env(safe-area-inset-bottom)" } }}
      >
        <Stack gap={2} pb="md">
          {navLinks(more.close)}
          <NavLink label="My account" leftSection={<IconBuildingStore size={20} />} onClick={() => { more.close(); navigate("/account"); }} />
          <NavLink label="Sign out" color="red" leftSection={<IconLogout size={20} />} onClick={() => signOut()} />
        </Stack>
      </Drawer>
    </AppShell>
  );
}

function RateChip() {
  const rates = useRates();
  const navigate = useNavigate();
  const main = rates.data?.find((r) => r.metal === "gold" && r.purity === "22K")
    ?? rates.data?.find((r) => r.metal === "gold");
  if (!main) return null;
  return (
    <UnstyledButton onClick={() => navigate("/rates")} className={classes.rateChip} visibleFrom="xs">
      <IconChartBar size={14} />
      <span>{main.purity} · {Math.round(main.rate_per_g).toLocaleString("en-US")}/g</span>
    </UnstyledButton>
  );
}

function initials(name?: string | null) {
  return (name ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
