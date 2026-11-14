import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createApiClient } from "./api.ts";

const queryClient = new QueryClient();
const client = createApiClient(import.meta.env.VITE_FRIDAY_API_BASE ?? "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App client={client} />
    </QueryClientProvider>
  </StrictMode>,
);
