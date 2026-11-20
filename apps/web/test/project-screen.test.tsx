import type { IssueItem, RunItem } from "@friday/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../src/api.ts";
import { ProjectScreen } from "../src/ProjectScreen.tsx";
import { queryKeys } from "../src/query-keys.ts";

const host = { name: "h1", baseUrl: "" };
const never = () => new Promise<never>(() => undefined);
const client: ApiClient = {
  fetchHealth: never,
  fetchProjects: never,
  fetchProjectOverview: never,
  fetchIssues: never,
  fetchRuns: never,
  fetchApprovals: never,
  fetchStatus: never,
  postDecision: never,
};
const issue: IssueItem = { issueId: 13, state: "Todo", heldReason: null };
const runItem: RunItem = {
  id: "r1",
  issueId: 13,
  phase: null,
  status: "failed",
  startedAt: null,
  finishedAt: null,
  costUsd: null,
  numTurns: null,
};

function render(qc: QueryClient) {
  const clientFor = vi.fn(() => client);
  const html = renderToString(
    <QueryClientProvider client={qc}>
      <ProjectScreen host={host} project="o/r" clientFor={clientFor} />
    </QueryClientProvider>,
  );
  return { html, clientFor };
}

describe("project screen", () => {
  it("screen loads through the host client and keys the cache by host", () => {
    const loading = render(new QueryClient());
    expect(loading.html).toContain("Carregando issues e runs...");
    expect(loading.html).not.toContain("data-list=");
    expect(loading.clientFor).toHaveBeenCalledTimes(1);
    expect(loading.clientFor).toHaveBeenCalledWith(host);

    const qc = new QueryClient();
    qc.setQueryData(queryKeys.projectIssues("o/r", "h1"), [issue]);
    qc.setQueryData(queryKeys.projectRuns("o/r", "h1"), [runItem]);
    const ready = render(qc).html;
    expect(ready).toContain('data-issue-id="13"');
    expect(ready).toContain('data-run-id="r1"');

    const other = new QueryClient();
    other.setQueryData(queryKeys.projectIssues("o/r", "h2"), [issue]);
    other.setQueryData(queryKeys.projectRuns("o/r", "h2"), [runItem]);
    expect(render(other).html).toContain("Carregando issues e runs...");
  });
});
