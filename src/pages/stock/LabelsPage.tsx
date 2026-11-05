import { Button, Card, Group, Text } from "@mantine/core";
import { IconArrowLeft, IconPrinter } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ErrorText, Loading, PageHeader } from "@/components/ui";
import { money } from "@/lib/format";
import { unwrap, useSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

interface LabelItem {
  id: string; tag: string; name: string; metal: string; purity: string | null;
  net_weight_g: number | null; tracking: string; fixed_price: number | null;
}

export default function LabelsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { settings, fmt } = useSettings();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 200);

  const labels = useQuery({
    queryKey: ["labels", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const items = unwrap(await supabase.from("items")
        .select("id, tag, name, metal, purity, net_weight_g, tracking, fixed_price").in("id", ids)) as LabelItem[];
      // QR encodes only the tag; scanning it in the app opens the item.
      return Promise.all(items.map(async (i) => ({ ...i, qr: await QRCode.toDataURL(i.tag, { margin: 0, width: 160, errorCorrectionLevel: "M" }) })));
    },
  });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Print labels"
          subtitle="50 × 25 mm tags. Use your label printer, or print on A4 and cut."
          actions={
            <>
              <Button variant="default" leftSection={<IconArrowLeft size={18} />} onClick={() => navigate(-1)}>Back</Button>
              <Button leftSection={<IconPrinter size={18} />} onClick={() => window.print()} disabled={!labels.data?.length}>Print</Button>
            </>
          }
        />
      </div>
      {labels.isLoading && <Loading />}
      <ErrorText error={labels.error} />
      <Card className="print-area">
        <div className="label-sheet">
          {(labels.data ?? []).map((l) => (
            <div className="label" key={l.id}>
              <img src={l.qr} alt={l.tag} />
              <div>
                <div className="tag">{l.tag}</div>
                <div className="meta">
                  {l.purity ? `${l.purity} ${l.metal}` : l.metal}
                  <br />
                  {l.tracking === "piece" && l.net_weight_g !== null ? `${Number(l.net_weight_g).toFixed(3)} g net` : l.fixed_price !== null ? money(l.fixed_price, fmt) : ""}
                  <br />
                  {settings?.shop_name}
                </div>
              </div>
            </div>
          ))}
        </div>
        {labels.data?.length === 0 && <Group justify="center" py="xl"><Text c="dimmed">No items selected.</Text></Group>}
      </Card>
    </>
  );
}
