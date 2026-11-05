import { Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import {
  IconCake, IconCash, IconCoins, IconDiamond, IconHeart, IconPackage, IconPlus, IconReceipt, IconTrendingUp,
} from "@tabler/icons-react";
import { Link, useNavigate } from "react-router-dom";
import { HoldingsCard } from "@/components/HoldingsCard";
import { ScanButton } from "@/components/ScanButton";
import { ErrorText, Loading, Money, PageHeader, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { methodLabel, money, phoneDisplay, shortDate } from "@/lib/format";
import { useDashboard, useSettings } from "@/lib/queries";

export default function DashboardPage() {
  const { profile } = useAuth();
  const { data, isLoading, error } = useDashboard();
  const { fmt } = useSettings();
  const navigate = useNavigate();

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  return (
    <>
      <PageHeader
        title={`${greeting}, ${profile?.full_name.split(" ")[0]}`}
        subtitle={data ? shortDate(data.today) : undefined}
        actions={
          <>
            <ScanButton onScan={(tag) => navigate(`/stock?q=${encodeURIComponent(tag)}`)} />
            <Button variant="default" leftSection={<IconPlus size={18} />} component={Link} to="/stock/new">Receive stock</Button>
            <Button color="gold" leftSection={<IconReceipt size={18} />} component={Link} to="/sell">New sale</Button>
          </>
        }
      />

      {isLoading && <Loading />}
      <ErrorText error={error} />

      {data && (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
            <StatCard label="Sales today" value={money(data.sales_today.total, fmt)} hint={`${data.sales_today.count} invoices`} icon={<IconCash size={22} />} accent="green" />
            <StatCard
              label="Pieces in stock"
              value={data.pieces_by_category.reduce((s, c) => s + Number(c.pieces), 0).toLocaleString()}
              hint={`${data.pieces_by_category.length} categories`}
              icon={<IconDiamond size={22} />} accent="gold"
            />
            <StatCard label="Balances due" value={money(data.balances_due.reduce((s, c) => s + Number(c.balance), 0), fmt)} hint={`${data.balances_due.length} clients`} icon={<IconCoins size={22} />} accent="orange" />
            <StatCard label="Low stock" value={data.low_stock.length} hint="bulk items" icon={<IconPackage size={22} />} accent="red" />
          </SimpleGrid>

          <HoldingsCard />

          {data.admin && (
            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
              <StatCard label="Stock value (today's rate)" value={money(data.admin.stock_value_today, fmt)} hint={`At cost: ${money(data.admin.stock_value_cost, fmt)}`} icon={<IconTrendingUp size={22} />} />
              <StatCard label="Gross profit today" value={money(data.admin.gross_profit_today, fmt)} hint="items with a cost only" />
              <StatCard label="Gross profit this month" value={money(data.admin.gross_profit_month, fmt)} hint={`${data.admin.sales_month.count} sales · ${money(data.admin.sales_month.total, fmt)}`} />
              <StatCard
                label="Items missing cost"
                value={data.admin.missing_cost_count}
                hint={data.admin.missing_cost_count ? <Anchor component={Link} to="/stock?missingCost=1" size="xs">Fill them in</Anchor> : "All set"}
              />
            </SimpleGrid>
          )}

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Card>
              <Group justify="space-between" mb="sm">
                <Title order={4}>Today's rates</Title>
                <Anchor component={Link} to="/rates" size="sm">All rates</Anchor>
              </Group>
              {data.rates.length === 0 ? <Text c="dimmed" size="sm">No rates set yet.</Text> : (
                <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="xs">
                  {data.rates.map((r) => (
                    <Card key={`${r.metal}-${r.purity}`} padding="sm" bg={r.metal === "gold" ? "gold.0" : "gray.0"} withBorder={false}>
                      <Text size="xs" c="dimmed" tt="capitalize">{r.metal} {r.purity}</Text>
                      <Money value={r.rate_per_g} fw={700} />
                      <Text size="xs" c={r.is_today ? "green" : "orange"}>{r.is_today ? "per gram · today" : `from ${shortDate(r.effective_on)}`}</Text>
                    </Card>
                  ))}
                </SimpleGrid>
              )}
              {Object.keys(data.payments_today).length > 0 && (
                <Group gap="xs" mt="md">
                  <Text size="sm" c="dimmed">Received today:</Text>
                  {Object.entries(data.payments_today).map(([m, v]) => (
                    <Badge key={m} color="ink" variant="outline">{methodLabel(m)} {money(v, fmt)}</Badge>
                  ))}
                </Group>
              )}
            </Card>

            <Card>
              <Title order={4} mb="sm">Stock by category</Title>
              {data.pieces_by_category.length === 0 ? <Text c="dimmed" size="sm">No stock yet.</Text> : (
                <Table verticalSpacing={6}>
                  <Table.Tbody>
                    {data.pieces_by_category.map((c) => (
                      <Table.Tr key={c.category}>
                        <Table.Td>{c.category}</Table.Td>
                        <Table.Td ta="right" className="tabular">{c.pieces}</Table.Td>
                        <Table.Td ta="right" c="dimmed" className="tabular">{c.net_weight_g ? `${Number(c.net_weight_g).toFixed(2)} g` : ""}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>

            <Card>
              <Title order={4} mb="sm">Clients with balance due</Title>
              {data.balances_due.length === 0 ? <Text c="dimmed" size="sm">Nobody owes anything. 🎉</Text> : (
                <Table verticalSpacing={6}>
                  <Table.Tbody>
                    {data.balances_due.map((c) => (
                      <Table.Tr key={c.id} data-clickable onClick={() => navigate(`/clients/${c.id}`)}>
                        <Table.Td><Text size="sm" fw={500}>{c.full_name}</Text><Text size="xs" c="dimmed">{phoneDisplay(c.phone)}</Text></Table.Td>
                        <Table.Td ta="right"><Money value={c.balance} fw={600} c="orange.8" /></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>

            <Card>
              <Title order={4} mb="sm">Coming up this week</Title>
              {data.upcoming_dates.length === 0 && data.low_stock.length === 0 ? <Text c="dimmed" size="sm">Nothing coming up.</Text> : (
                <Stack gap="xs">
                  {data.upcoming_dates.map((d) => (
                    <Group key={`${d.id}-${d.kind}`} justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap">
                        {d.kind === "birthday" ? <IconCake size={18} color="var(--mantine-color-pink-6)" /> : <IconHeart size={18} color="var(--mantine-color-red-6)" />}
                        <Anchor component={Link} to={`/clients/${d.id}`} size="sm">{d.full_name}</Anchor>
                      </Group>
                      <Text size="xs" c="dimmed">{d.kind} · {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</Text>
                    </Group>
                  ))}
                  {data.low_stock.map((i) => (
                    <Group key={i.id} justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap">
                        <IconPackage size={18} color="var(--mantine-color-red-6)" />
                        <Anchor component={Link} to={`/stock/${i.id}`} size="sm">{i.name}</Anchor>
                      </Group>
                      <Text size="xs" c="red">only {i.qty_on_hand} left</Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>
          </SimpleGrid>

          {data.admin && data.admin.discounts_by_staff.length > 0 && (
            <Card>
              <Title order={4} mb="sm">Discounts given this month</Title>
              <Table>
                <Table.Thead><Table.Tr><Table.Th>Staff</Table.Th><Table.Th ta="right">Sales</Table.Th><Table.Th ta="right">Discount</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {data.admin.discounts_by_staff.map((d) => (
                    <Table.Tr key={d.full_name}>
                      <Table.Td>{d.full_name}</Table.Td>
                      <Table.Td ta="right">{d.sales}</Table.Td>
                      <Table.Td ta="right"><Money value={d.discount} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}
        </Stack>
      )}
    </>
  );
}
