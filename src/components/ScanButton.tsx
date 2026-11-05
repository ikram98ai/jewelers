import { ActionIcon, Button, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconQrcode } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

/**
 * Opens the phone camera and returns the first QR/text it reads.
 * Labels encode the item tag (e.g. "RNG-00042"). A USB barcode scanner also
 * works without this: it simply types into the focused search box.
 */
export function ScanButton({ onScan, compact = false, label = "Scan" }: {
  onScan: (text: string) => void;
  compact?: boolean;
  label?: string;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <>
      {compact ? (
        <Tooltip label="Scan tag">
          <ActionIcon size="input-md" variant="light" color="gold" onClick={open} aria-label="Scan tag">
            <IconQrcode size={22} />
          </ActionIcon>
        </Tooltip>
      ) : (
        <Button variant="light" color="gold" leftSection={<IconQrcode size={20} />} onClick={open}>{label}</Button>
      )}
      <Modal opened={opened} onClose={close} title="Scan item tag" size="md">
        {opened && <Scanner onResult={(t) => { close(); onScan(t); }} />}
      </Modal>
    </>
  );
}

function Scanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let scanner: { stop: () => void; destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !videoRef.current) return;
        const s = new QrScanner(videoRef.current, (result) => {
          s.stop();
          onResult(result.data.trim());
        }, { preferredCamera: "environment", highlightScanRegion: true, maxScansPerSecond: 8 });
        scanner = s;
        await s.start();
      } catch {
        setError("Camera not available. Allow camera access, or type the tag instead.");
      }
    })();
    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [onResult]);

  return (
    <Stack>
      <video ref={videoRef} style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "1 / 1", objectFit: "cover" }} muted playsInline />
      {error ? <Text c="red" size="sm">{error}</Text> : <Text size="sm" c="dimmed">Point the camera at the QR code on the tag.</Text>}
    </Stack>
  );
}
