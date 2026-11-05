import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";

import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { theme } from "./theme";

// Refuse to run inside a frame (clickjacking): break out, or stay hidden.
if (window.self !== window.top) {
  try {
    window.top!.location.href = window.self.location.href;
  } catch {
    /* cross-origin parent: we simply stay hidden */
  }
  throw new Error("Jewelers refuses to run inside a frame.");
}
document.getElementById("anti-clickjack")?.remove();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => count < 2 && !String((err as { code?: string })?.code ?? "").startsWith("42"),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-center" limit={3} />
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>
          {/* HashRouter: GitHub Pages cannot rewrite deep links to index.html. */}
          <HashRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </HashRouter>
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
