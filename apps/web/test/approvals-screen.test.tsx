import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../src/api.ts";
import { ApprovalsScreen, approvalsMessage } from "../src/ApprovalsScreen.tsx";

afterEach(() => vi.unstubAllGlobals());

const never = () => new Promise<never>(() => undefined);
const client: ApiClient = {
  fetchHealth: never,
  fetchProjects: never,
  fetchProjectOverview: never,
  fetchApprovals: never,
  fetchStatus: never,
  postDecision: never,
  fetchIssues: never,
  fetchRuns: never,
};
const item = {
  id: "a1",
  issueId: 14,
  pr: 5,
  headSha: "abc123",
  tier: "low" as const,
  requestedAt: 1,
  expiresAt: 2,
};
const status = { enabled: true, breaker: { open: false, openedAt: null, failures: [] } };

function render(qc: QueryClient): string {
  return renderToString(
    <QueryClientProvider client={qc}>
      <ApprovalsScreen client={client} host="h1" project="o/r" />
    </QueryClientProvider>,
  );
}
function stubStorage(entries: Record<string, string>): void {
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => entries[k] ?? null,
    setItem: () => undefined,
  });
}

describe("ApprovalsScreen", () => {
  it("approvalsMessage maps each state and the screen shows loading, loaded data and the token field", () => {
    expect(approvalsMessage("loading")).toBe("Carregando aprovações...");
    expect(approvalsMessage("error")).toBe("Não foi possível carregar as aprovações.");
    expect(approvalsMessage("ready")).toBeNull();
    stubStorage({});
    const loading = render(new QueryClient());
    expect(loading).toContain("Carregando aprovações...");
    expect(loading).toContain('type="password"');
    expect(loading).toContain("Salvar token");
    expect(loading).not.toContain('data-list="approvals"');
    const qc = new QueryClient();
    qc.setQueryData(["approvals", "o/r"], [item]);
    qc.setQueryData(["status", "o/r"], status);
    const ready = render(qc);
    expect(ready).toContain('data-approval-id="a1"');
    expect(ready).toContain('data-section="status"');
    expect(ready).toContain("disabled");
    stubStorage({ "friday.panelToken.h1": "s3cret" });
    const withToken = render(qc);
    expect(withToken).toContain('data-approval-id="a1"');
    expect(withToken).not.toContain("disabled");
  });
});
