import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app.tsx";
import { RepositoryProvider } from "./repository-context.tsx";
import { PortalErrorBoundary, PortalProvider } from "./portal-theme.tsx";
import { HttpPortalRepository } from "./transport.ts";
import "./styles.css";
import "./fluent.css";
import "./i18n.ts";

const repository = __VOS_PORTAL_DEMO__
  ? new (await import("../demo/local-storage-repository.ts")).LocalStoragePortalRepository()
  : new HttpPortalRepository();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortalProvider>
      <PortalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RepositoryProvider value={repository}>
            <BrowserRouter><App demo={__VOS_PORTAL_DEMO__} /></BrowserRouter>
          </RepositoryProvider>
        </QueryClientProvider>
      </PortalErrorBoundary>
    </PortalProvider>
  </StrictMode>,
);
