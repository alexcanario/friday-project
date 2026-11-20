import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import type { ApiClient } from "../src/api.ts";
import { defaultClientFor } from "../src/client-for.ts";
import { HostCardView } from "../src/HostCard.tsx";
import type { HostCardState } from "../src/host-card-state.ts";
import { ProjectScreenView } from "../src/ProjectView.tsx";
import type { ProjectState } from "../src/project-state.ts";
import { queryKeys } from "../src/query-keys.ts";

afterEach(() => vi.unstubAllGlobals());

const SECRET = "s3cret-xyz";
const client: ApiClient = {
  fetchHealth: () => Promise.resolve({ status: "ok" }),
  fetchProjects: () => Promise.resolve([]),
  fetchProjectOverview: () => Promise.reject(new Error("unused")),
  fetchIssues: () => Promise.resolve([]),
  fetchRuns: () => Promise.resolve([]),
  fetchApprovals: () => Promise.reject(new Error("unused")),
  fetchStatus: () => Promise.reject(new Error("unused")),
  fetchRun: () => Promise.reject(new Error("unused")),
  fetchRunReview: () => Promise.reject(new Error("unused")),
  postDecision: () => Promise.reject(new Error("unused")),
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

describe("token on the approvals section", () => {
  it("never renders the approvals token and each host client sends only its own", async () => {
    const tokens: Record<string, string> = {
      "friday.panelToken.h1": SECRET,
      "friday.panelToken.h2": "other-token-h2",
    };
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => tokens[k] ?? null,
      setItem: () => undefined,
    });
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.approvals("a/b", "h1"), [
      {
        id: "a1",
        issueId: 14,
        pr: 5,
        headSha: "abc123",
        tier: "low",
        requestedAt: 1,
        expiresAt: 2,
      },
    ]);
    qc.setQueryData(queryKeys.status("a/b", "h1"), {
      enabled: true,
      breaker: { open: false, openedAt: null, failures: [] },
    });
    const html = renderToString(
      <QueryClientProvider client={qc}>
        <App
          client={client}
          hosts={[host]}
          search="?host=h1&project=a%2Fb"
          clientFor={() => client}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("data-approval-id");
    expect(html).not.toContain(SECRET);
    expect(html).not.toMatch(/href="[^"]*s3cret/);
    const fetchMock = vi.fn(() => Promise.resolve(new Response("[]")));
    vi.stubGlobal("fetch", fetchMock);
    await defaultClientFor(host).fetchApprovals("o/r");
    await defaultClientFor({ name: "h2", baseUrl: "" }).fetchApprovals("o/r");
    const [first, second] = fetchMock.mock.calls as unknown as [
      [string, { headers: Record<string, string> }],
      [string, { headers: Record<string, string> }],
    ];
    expect(first[0]).not.toContain(SECRET);
    expect(first[1].headers["x-friday-token"]).toBe(SECRET);
    expect(second[0]).not.toContain("other-token-h2");
    expect(second[1].headers["x-friday-token"]).toBe("other-token-h2");
    expect(JSON.stringify(second)).not.toContain(SECRET);
  });
});

describe("token on the project screen", () => {
  it("never renders the token on the project screen and the host client sends it", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => (k === "friday.panelToken.h1" ? SECRET : null),
      setItem: () => undefined,
    });
    const app = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <App
          client={client}
          hosts={[host]}
          search="?host=h1&project=a%2Fb"
          clientFor={() => client}
        />
      </QueryClientProvider>,
    );
    const states: ProjectState[] = ["loading", "offline", "unauthorized", "error", "ready"];
    const views = states.map((state) =>
      renderToString(
        <ProjectScreenView host={host} project="o/r" state={state} issues={[]} runs={[]} />,
      ),
    );
    for (const html of [app, ...views]) {
      expect(html).not.toContain(SECRET);
      expect(html).not.toMatch(/href="[^"]*s3cret/);
    }
    const fetchMock = vi.fn(() => Promise.resolve(new Response("[]")));
    vi.stubGlobal("fetch", fetchMock);
    await defaultClientFor(host).fetchIssues("o/r");
    expect(fetchMock).toHaveBeenCalledWith("/issues?project=o%2Fr", {
      headers: { "x-friday-token": SECRET },
    });
  });
});
