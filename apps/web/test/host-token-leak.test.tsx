import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import type { ApiClient } from "../src/api.ts";
import { HostCardView } from "../src/HostCard.tsx";
import type { HostCardState } from "../src/host-card-state.ts";

afterEach(() => vi.unstubAllGlobals());

const SECRET = "s3cret-xyz";
const client: ApiClient = {
  fetchHealth: () => Promise.resolve({ status: "ok" }),
  fetchProjects: () => Promise.resolve([]),
  fetchProjectOverview: () => Promise.reject(new Error("unused")),
};
const host = { name: "h1", baseUrl: "" };

describe("token leak", () => {
  it("never renders the token or puts it in a link", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => (k === "friday.panelToken.h1" ? SECRET : null),
      setItem: () => undefined,
    });
    const proj = {
      id: "a/b",
      enabled: true,
      breakerOpen: false,
      activeRuns: 0,
      dayCostUsd: 0,
      anyCostUnknown: false,
    };
    const states: HostCardState[] = [
      { kind: "loading" },
      { kind: "offline" },
      { kind: "error" },
      { kind: "unauthorized" },
      { kind: "ready", projects: [proj] },
    ];
    const pages = ["", "?host=h1&project=a%2Fb"].map((search) =>
      renderToString(
        <QueryClientProvider client={new QueryClient()}>
          <App client={client} hosts={[host]} search={search} clientFor={() => client} />
        </QueryClientProvider>,
      ),
    );
    const cards = states.map((state) =>
      renderToString(<HostCardView host={host} state={state} onSaveToken={() => undefined} />),
    );
    for (const html of [...pages, ...cards]) {
      expect(html).not.toContain(SECRET);
      expect(html).not.toMatch(/href="[^"]*s3cret/);
    }
  });
});
