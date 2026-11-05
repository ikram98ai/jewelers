import { Button, Group, type ButtonProps } from "@mantine/core";
import { IconCamera, IconPhoto } from "@tabler/icons-react";
import { useRef } from "react";

/**
 * Two ways to add photos on phones:
 *  - Camera: `capture` opens the rear camera directly.
 *  - Gallery: no `capture`, so the phone shows its photo library / files picker,
 *    with several photos selectable at once (up to `max`).
 * On desktop both open the normal file picker.
 */
export function PhotoPicker({ onFiles, max, loading, fullWidth, size = "sm", h, galleryLabel = "Gallery", cameraLabel = "Camera" }: {
  onFiles: (files: File[]) => void;
  /** How many more photos may be added (1 = single photo). */
  max: number;
  loading?: boolean;
  fullWidth?: boolean;
  size?: ButtonProps["size"];
  h?: number;
  galleryLabel?: string;
  cameraLabel?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  if (max <= 0) return null;

  const take = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith("image/")).slice(0, max);
    input.value = "";  // allow picking the same photo again
    if (files.length) onFiles(files);
  };

  return (
    <Group gap="xs" grow={fullWidth} wrap="nowrap">
      <Button variant="light" color="gold" size={size} h={h} loading={loading} leftSection={<IconCamera size={18} />}
        onClick={() => cameraRef.current?.click()}>{cameraLabel}</Button>
      <Button variant="light" color="gold" size={size} h={h} loading={loading} leftSection={<IconPhoto size={18} />}
        onClick={() => galleryRef.current?.click()}>{galleryLabel}</Button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.currentTarget)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple={max > 1} hidden onChange={(e) => take(e.currentTarget)} />
    </Group>
  );
}
