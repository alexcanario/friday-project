import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createApiClient } from "./api.ts";
import { loadHosts } from "./hosts-config.ts";
import { projectFromSearch } from "./project-param.ts";

const queryClient = new QueryClient();
const baseUrl = import.meta.env.VITE_FRIDAY_API_BASE ?? "";
const client = createApiClient(baseUrl);
const project = projectFromSearch(window.location.search);
const root = createRoot(document.getElementById("root")!);

function show(hosts: Awaited<ReturnType<typeof loadHosts>> | null): void {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App
          client={client}
          project={project}
          baseUrl={baseUrl}
          hosts={hosts}
          search={window.location.search}
        />
      </QueryClientProvider>
    </StrictMode>,
  );
}

loadHosts().then(show, () => show(null));
