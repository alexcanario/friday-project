import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";
import type { ApiClient } from "../src/api.ts";
import { connectionStateOf } from "../src/connection-state.ts";
import { ConnectionStatus } from "../src/ConnectionStatus.tsx";

const client: ApiClient = { fetchHealth: () => Promise.resolve({ status: "ok" }) };
const TEXTS = ["Carregando…", "Conectado", "Sem conexão"];

function renderApp(qc: QueryClient): string {
  return renderToString(
    <QueryClientProvider client={qc}>
      <App client={client} />
    </QueryClientProvider>,
  );
}

describe("panel page", () => {
  it("renders title, loading state and the three connection states", () => {
    const states = ["loading", "connected", "offline"] as const;
    states.forEach((state, i) => {
      const html = renderToString(<ConnectionStatus state={state} />);
      expect(html).toContain(TEXTS[i]);
      TEXTS.forEach((t, j) => {
        if (j !== i) expect(html).not.toContain(t);
      });
    });
    const html = renderApp(new QueryClient());
    expect(html).toContain("Friday");
    expect(html).toContain("Carregando…");
  });

  it("maps the query status to the connection state", () => {
    expect(connectionStateOf("pending")).toBe("loading");
    expect(connectionStateOf("error")).toBe("offline");
    expect(connectionStateOf("success")).toBe("connected");
    const qc = new QueryClient();
    qc.setQueryData(["health"], { status: "ok" });
    const html = renderApp(qc);
    expect(html).toContain("Conectado");
    expect(html).not.toContain("Carregando…");
  });
});
