import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import type { ApiClient } from "../src/api.ts";
import { queryKeys } from "../src/query-keys.ts";

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
const hostClient: ApiClient = {
  ...client,
  fetchIssues: () => new Promise(() => undefined),
  fetchRuns: () => new Promise(() => undefined),
};
const hosts = [
  { name: "h1", baseUrl: "" },
  { name: "h2", baseUrl: "" },
];

function render(search: string, hostList: typeof hosts | null = hosts) {
  const clientFor = vi.fn(() => hostClient);
  const html = renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <App client={client} hosts={hostList} search={search} clientFor={clientFor} />
    </QueryClientProvider>,
  );
  return { html, clientFor };
}

describe("app with hosts", () => {
  it("selects host and project from the URL and renders the project screen with the host client", () => {
    let r = render("?host=h1&project=a%2Fb");
    expect(r.html).toContain('data-view="project"');
    expect(r.html).toContain("Projeto a/b em h1");
    expect(r.html).toContain('data-action="back"');
    expect(r.html).toContain('data-slot="approvals"');
    expect(r.html).not.toContain("data-host-card=");
    expect(r.clientFor).toHaveBeenCalledTimes(1);
    expect(r.clientFor).toHaveBeenCalledWith(hosts[0]);
    r = render("?host=zzz&project=a%2Fb");
    expect(r.html).toContain("Host desconhecido: zzz.");
    expect(r.html).not.toContain('data-view="project"');
    expect(r.html).not.toContain("data-host-card=");
    expect(r.clientFor).toHaveBeenCalledTimes(0);
    r = render("");
    expect(r.html).not.toContain('data-view="project"');
    expect(r.clientFor).toHaveBeenCalledTimes(2);
    expect(render("", null).html).toContain("Não foi possível ler a lista de hosts.");
  });

  it("renders the run detail with the host client and the host in the cache key", () => {
    const run = {
      id: "r1",
      issueId: 14,
      phase: null,
      status: "running" as const,
      startedAt: null,
      finishedAt: null,
      costUsd: 0.5,
      numTurns: 3,
    };
    const review = { judge: null, pr: null };
    function renderRun(search: string, seededHost: string) {
      const qc = new QueryClient();
      qc.setQueryData(queryKeys.projectRun("a/b", "r1", seededHost), run);
      qc.setQueryData(queryKeys.projectRunReview("a/b", "r1", seededHost), review);
      const clientFor = vi.fn(() => ({
        ...hostClient,
        fetchRun: () => new Promise<never>(() => undefined),
        fetchRunReview: () => new Promise<never>(() => undefined),
      }));
      const html = renderToString(
        <QueryClientProvider client={qc}>
          <App client={client} hosts={hosts} search={search} clientFor={clientFor} />
        </QueryClientProvider>,
      );
      return { html, clientFor };
    }
    let r = renderRun("?host=h1&project=a%2Fb&run=r1", "h1");
    expect(r.html).toContain('data-view="run"');
    expect(r.html).toContain("Run r1 de a/b em h1");
    expect(r.html).toContain('data-field="cost">$0.50<');
    expect(r.html).not.toContain('data-view="project"');
    expect(r.html).not.toContain("data-host-card=");
    expect(r.clientFor).toHaveBeenCalledTimes(1);
    expect(r.clientFor).toHaveBeenCalledWith(hosts[0]);
    r = renderRun("?host=h1&project=a%2Fb&run=r1", "h2");
    expect(r.html).toContain("Carregando a run...");
    expect(r.html).not.toContain('data-field="cost"');
    r = renderRun("?host=h1&project=a%2Fb", "h1");
    expect(r.html).toContain('data-view="project"');
    r = renderRun("?host=zzz&project=a%2Fb&run=r1", "h1");
    expect(r.html).toContain("Host desconhecido: zzz.");
    expect(r.clientFor).toHaveBeenCalledTimes(0);
  });
});
