import { Box, Image } from "@mantine/core";
import { IconDiamond } from "@tabler/icons-react";

export function ItemThumb({ url, size = 48 }: { url?: string | null; size?: number }) {
  return (
    <Box
      w={size} h={size}
      style={{
        borderRadius: 10, overflow: "hidden", flexShrink: 0, display: "grid", placeItems: "center",
        background: "linear-gradient(135deg, #fdf8ea, #f1e3bd)",
      }}
    >
      {url ? <Image src={url} w={size} h={size} fit="cover" alt="" loading="lazy" /> : <IconDiamond size={size * 0.45} color="#c08c02" />}
    </Box>
  );
}
