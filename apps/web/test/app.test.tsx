import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import type { ApiClient } from "../src/api.ts";
import { connectionStateOf, displayState, liveStateFor } from "../src/connection-state.ts";
import { ConnectionStatus } from "../src/ConnectionStatus.tsx";

const client: ApiClient = {
  fetchHealth: () => Promise.resolve({ status: "ok" }),
  fetchProjects: () => Promise.resolve([]),
  fetchProjectOverview: () => Promise.reject(new Error("unused")),
  fetchApprovals: () => Promise.reject(new Error("unused")),
  fetchStatus: () => Promise.reject(new Error("unused")),
  fetchRun: () => Promise.reject(new Error("unused")),
  fetchRunReview: () => Promise.reject(new Error("unused")),
  postDecision: () => Promise.reject(new Error("unused")),
  fetchIssues: () => Promise.resolve([]),
  fetchRuns: () => Promise.resolve([]),
};
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

  it("renders the reconnecting state alone", () => {
    const html = renderToString(<ConnectionStatus state="reconnecting" />);
    expect(html).toContain("Reconectando…");
    expect(html).toContain('data-state="reconnecting"');
    TEXTS.forEach((t) => expect(html).not.toContain(t));
  });

  it("live state overrides the health state", () => {
    expect(displayState("reconnecting", "success")).toBe("reconnecting");
    expect(displayState(null, "success")).toBe("connected");
    expect(displayState(null, "error")).toBe("offline");
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("live state of a stream", () => {
  it("liveStateFor drops the state of another stream", () => {
    expect(liveStateFor({ key: "a", state: "offline" }, "a")).toBe("offline");
    expect(liveStateFor({ key: "a", state: "offline" }, "b")).toBeNull();
    expect(liveStateFor(null, "a")).toBeNull();
    expect(displayState(liveStateFor({ key: "a", state: "offline" }, "b"), "success", true)).toBe(
      "loading",
    );
  });
});

describe("header with a selected host", () => {
  it("header shows loading for a selected host and health on the overview", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => (key === "friday.panelToken.h1" ? "tok" : null),
      setItem: () => undefined,
    });
    expect(displayState(null, "success", true)).toBe("loading");
    expect(displayState("connected", "error", true)).toBe("connected");
    expect(displayState(null, "success")).toBe("connected");
    const qc = new QueryClient();
    qc.setQueryData(["health"], { status: "ok" });
    const hosts = [{ name: "h1", baseUrl: "" }];
    const render = (search: string): string =>
      renderToString(
        <QueryClientProvider client={qc}>
          <App client={client} hosts={hosts} search={search} clientFor={() => client} />
        </QueryClientProvider>,
      );
    const selected = render("?host=h1&project=a%2Fb");
    expect(selected).toContain("Carregando…");
    expect(selected).not.toContain("Conectado");
    const overview = render("");
    expect(overview).toContain("Conectado");
    expect(overview).not.toContain("Carregando…");
  });
});
