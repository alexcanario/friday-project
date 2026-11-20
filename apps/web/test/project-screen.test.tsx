import type { IssueItem, RunItem } from "@friday/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
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
  fetchRun: never,
  fetchRunReview: never,
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

function render(qc: QueryClient, approvals?: ReactNode) {
  const clientFor = vi.fn(() => client);
  const html = renderToString(
    <QueryClientProvider client={qc}>
      <ProjectScreen host={host} project="o/r" clientFor={clientFor} approvals={approvals} />
    </QueryClientProvider>,
  );
  return { html, clientFor };
}
const approvalItem = {
  id: "a1",
  issueId: 13,
  pr: 5,
  headSha: "abc123",
  tier: "low" as const,
  requestedAt: 1,
  expiresAt: 2,
};
const statusItem = { enabled: true, breaker: { open: false, openedAt: null, failures: [] } };
function seed(name: string, withApprovals: boolean): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.projectIssues("o/r", name), [issue]);
  qc.setQueryData(queryKeys.projectRuns("o/r", name), [runItem]);
  if (withApprovals) {
    qc.setQueryData(queryKeys.approvals("o/r", name), [approvalItem]);
    qc.setQueryData(queryKeys.status("o/r", name), statusItem);
  }
  return qc;
}
const sectionOf = (html: string) => html.slice(html.indexOf('<section data-slot="approvals">'));

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

  it("renders the approvals section from the host client and keys it by host", () => {
    const ready = render(seed("h1", true));
    const html = ready.html;
    const section = sectionOf(html);
    const at = html.indexOf('data-slot="approvals"');
    expect(at).toBeGreaterThan(-1);
    expect(section).toContain('data-approval-id="a1"');
    expect(section).toContain('type="password"');
    expect(section).toContain("Salvar token");
    expect(at).toBeGreaterThan(html.indexOf('data-list="issues"'));
    expect(at).toBeGreaterThan(html.indexOf('data-list="runs"'));
    expect(ready.clientFor).toHaveBeenCalledTimes(1);
    expect(ready.clientFor).toHaveBeenCalledWith(host);
    const qc = seed("h1", false);
    qc.setQueryData(queryKeys.approvals("o/r", "h2"), [approvalItem]);
    qc.setQueryData(queryKeys.status("o/r", "h2"), statusItem);
    const crossed = sectionOf(render(qc).html);
    expect(crossed).toContain("Carregando aprovações...");
    expect(crossed).not.toContain("data-approval-id");
  });

  it("the approvals prop replaces the default section", () => {
    const html = render(seed("h1", true), <p>SUBST</p>).html;
    expect(html).toContain("SUBST");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("data-approval-id");
  });
});
