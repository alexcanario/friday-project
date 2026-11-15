import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createApiClient } from "./api.ts";
import { projectFromSearch } from "./project-param.ts";

const queryClient = new QueryClient();
const baseUrl = import.meta.env.VITE_FRIDAY_API_BASE ?? "";
const client = createApiClient(baseUrl);
const project = projectFromSearch(window.location.search);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App client={client} project={project} baseUrl={baseUrl} />
    </QueryClientProvider>
  </StrictMode>,
);
