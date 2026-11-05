import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Deep ink navy for structure and actions, warm gold as the accent.
const ink: MantineColorsTuple = [
  "#eef1f8", "#dbe1ee", "#b3c0dc", "#8a9dca", "#6880bb", "#526db2",
  "#4664af", "#37539a", "#2d4a8b", "#14213d",
];
const gold: MantineColorsTuple = [
  "#fdf8ea", "#f7eccf", "#efd89c", "#e7c365", "#e0b23a", "#dca71f",
  "#d9a10f", "#c08c02", "#ab7c00", "#946a00",
];

export const theme = createTheme({
  primaryColor: "ink",
  primaryShade: { light: 9, dark: 4 },
  colors: { ink, gold },
  autoContrast: true,
  fontFamily: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
  headings: {
    fontFamily: "'Fraunces Variable', Georgia, serif",
    fontWeight: "600",
  },
  defaultRadius: "md",
  cursorType: "pointer",
  fontSizes: { md: "1rem" },
  components: {
    Button: { defaultProps: { size: "md" } },
    TextInput: { defaultProps: { size: "md" } },
    NumberInput: { defaultProps: { size: "md", hideControls: true } },
    Select: { defaultProps: { size: "md", allowDeselect: false } },
    PasswordInput: { defaultProps: { size: "md" } },
    Textarea: { defaultProps: { size: "md", autosize: true, minRows: 2 } },
    Card: { defaultProps: { withBorder: true, radius: "lg", padding: "lg" } },
    Paper: { defaultProps: { radius: "lg" } },
    Modal: { defaultProps: { radius: "lg", centered: true, overlayProps: { blur: 2 } } },
    Badge: { defaultProps: { radius: "sm", variant: "light" } },
  },
});
