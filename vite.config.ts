/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL as NodeURL } from "node:url";

// GitHub Pages can't send security headers, so production builds carry a CSP
// <meta>. Scripts only from our origin; network only to our Supabase project;
// the only embedded frame is the live price chart.
function csp(supabaseUrl: string): Plugin {
  const api = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",          // Mantine injects CSS variables at runtime
    `img-src 'self' data: blob: ${api}`,
    "font-src 'self'",
    `connect-src 'self' ${api}`,
    "frame-src https://www.tradingview-widget.com", // live price chart on the Rates page
    "worker-src 'self' blob:",                    // QR scanner worker
    "media-src 'self' blob:",                     // camera preview
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return {
    name: "jewelers-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

// GitHub Pages serves the app from /<repo-name>/. Set VITE_BASE in CI
// (e.g. "/jewelers/"); locally it defaults to "/".
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: env.VITE_BASE || "/",
    plugins: [react(), csp(env.VITE_SUPABASE_URL ?? "")],
    resolve: { alias: { "@": fileURLToPath(new NodeURL("./src", import.meta.url)) } },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            mantine: ["@mantine/core", "@mantine/hooks", "@mantine/notifications", "@mantine/modals", "@mantine/form"],
            supabase: ["@supabase/supabase-js"],
          },
        },
      },
    },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});
