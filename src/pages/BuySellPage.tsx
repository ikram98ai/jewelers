import { Tabs } from "@mantine/core";
import { IconBuildingBank, IconShoppingBag } from "@tabler/icons-react";
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import NewSalePage from "./sales/NewSalePage";

const PurchaseNewPage = lazy(() => import("./purchases/PurchaseNewPage"));

/** The counter: sell to a client or buy from one. Buying pays money out, so it is admin only. */
export default function BuySellPage() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();

  if (!isAdmin) return <NewSalePage />;

  const setTab = (tab: string | null) => {
    const next = new URLSearchParams(params);
    if (tab === "buy") next.set("tab", "buy");
    else next.delete("tab");
    setParams(next, { replace: true });
  };

  // Both panels stay mounted, so switching tabs keeps a half-filled form.
  return (
    <Tabs value={params.get("tab") === "buy" ? "buy" : "sell"} onChange={setTab} variant="pills" color="gold">
      <Tabs.List mb="lg">
        <Tabs.Tab value="sell" leftSection={<IconShoppingBag size={18} />}>Sell</Tabs.Tab>
        <Tabs.Tab value="buy" leftSection={<IconBuildingBank size={18} />}>Buy</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="sell"><NewSalePage /></Tabs.Panel>
      <Tabs.Panel value="buy">
        <Suspense fallback={<Loading />}><PurchaseNewPage /></Suspense>
      </Tabs.Panel>
    </Tabs>
  );
}
