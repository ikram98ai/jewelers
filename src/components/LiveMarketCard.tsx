import { Anchor, Box, Card, Group, SegmentedControl, Text, Title } from "@mantine/core";
import { useState } from "react";
import { useSettings } from "@/lib/queries";

const SYMBOLS: Record<string, string> = { gold: "TVC:GOLD", silver: "TVC:SILVER" };

// The frame TradingView's embed script would create, used directly. Its script would otherwise run
// in this page, next to the login session, and the production CSP (vite.config.ts) rightly blocks it.
function chartUrl(symbol: string, timezone: string | undefined): string {
  const config = {
    symbol,
    interval: "60",
    timezone: timezone ?? "Etc/UTC",
    theme: "light",
    style: "2",
    autosize: true,
    allow_symbol_change: false,
    hide_side_toolbar: true,
    hide_volume: true,
    save_image: false,
    calendar: false,
  };
  return `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
}

export function LiveMarketCard() {
  const { settings } = useSettings();
  const [metal, setMetal] = useState("gold");
  const symbol = SYMBOLS[metal];

  return (
    <Card mb="lg">
      <Group justify="space-between" mb="xs" gap="sm">
        <Title order={4}>Live world market</Title>
        <SegmentedControl
          size="sm" aria-label="Metal" value={metal} onChange={setMetal}
          data={[{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }]}
        />
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        US dollars per ounce, for reference. This chart never changes your rates.
      </Text>
      <Box h={{ base: 340, sm: 440 }}>
        <iframe
          key={symbol}
          title={`Live ${metal} price chart from TradingView`}
          src={chartUrl(symbol, settings?.timezone)}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        />
      </Box>
      <Anchor href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`} target="_blank" rel="noopener noreferrer" size="xs" mt="xs" display="inline-block">
        Open on TradingView
      </Anchor>
    </Card>
  );
}
