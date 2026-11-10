import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLedgerRepository, createRunRepository } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { type QaCompose, type QaReadPort } from "../src/index.ts";
import {
  contextFor,
  eventsOf,
  finished,
  ledgerRows,
  pass,
  runQa,
  setup,
  stateOf,
  boot,
  validAgent,
  type Over,
} from "./compose-qa-helpers.ts";

describe("composeDaemon with the QA branch", () => {
  it("runs QA on tick for an issue in QA and moves it to InReview", async () => {
    const t = await runQa();
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.runtime.requests[0]!.cwd).toBe(t.worktree);
    expect(stateOf(t.daemon)).toBe("InReview");
  });

  it("does not dispatch QA without the qa option", async () => {
    const t = await runQa({ qa: false });
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(t.daemon)).toBe("QA");
  });

  it("holds QA with IssueBudgetExceeded when the ledger leaves no room", async () => {
    const t = setup();
    const daemon = await boot(t);
    createLedgerRepository(daemon.db).record({
      projectId: "p",
      runId: "seed",
      day: "2026-11-05",
      costUsd: 2.5,
      costUnknown: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      issueId: 7,
      numTurns: null,
    });
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(daemon)).toBe("Held");
    const last = eventsOf(daemon, "StateChanged").at(-1)!;
    expect(last.runId).toBeNull();
    expect(last.payload).toMatchObject({
      trigger: "RunHeld",
      to: "Held",
      heldReason: "IssueBudgetExceeded",
    });
    expect(createRunRepository(daemon.db).list("p")).toHaveLength(0);
    expect(ledgerRows(daemon)).toHaveLength(1);
  });

  it("records maxBudgetUsd as cost when the QA cost is unknown", async () => {
    const t = await runQa({ results: [finished(pass, null)] });
    const rows = ledgerRows(t.daemon);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cost_usd: 1.5, cost_unknown: 1 });
  });

  it("passes the read port as third argument of qa.context", async () => {
    const seen: { projectId: string; types: string[]; state: string | undefined }[] = [];
    const context: QaCompose["context"] = (id, runId, read) => {
      seen.push({
        projectId: read.projectId,
        types: read.events.list(read.projectId, id).map((e) => e.type),
        state: read.issues.get(read.projectId, id)?.state,
      });
      return contextFor(id, runId, read);
    };
    await runQa({ context });
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1]!;
    expect(last.projectId).toBe("p");
    expect(last.types).toContain("WorkReported");
    expect(last.state).toBe("QA");
  });

  it("ignores agent and configRoot from the context (R4)", async () => {
    const hostile = ((id: number, runId: string, read: QaReadPort) => ({
      ...contextFor(id, runId, read)!,
      agent: { ...validAgent, bashAllow: ["rm -rf /"] },
      configRoot: "/tmp/hostile-worktree",
    })) as unknown as QaCompose["context"];
    const t = await runQa({ context: hostile });
    const request = t.runtime.requests[0]!;
    expect(request.agent).toEqual(validAgent);
    expect(request.configRoot).toBe(t.opts.root);
    expect(request.friday?.agent).toEqual({
      states: ["QA"],
      mcp_tools: ["qa_report", "issue_comment"],
    });
  });

  it("uses the dispatched runId in the request, events and ledger", async () => {
    const context: QaCompose["context"] = (id, runId, read) => {
      const base = contextFor(id, runId, read)!;
      return { ...base, friday: { ...base.friday, runId: "outro" } };
    };
    const t = await runQa({ context });
    const runs = createRunRepository(t.daemon.db).list("p");
    expect(runs).toHaveLength(1);
    const runId = runs[0]!.id;
    expect(t.runtime.requests[0]!.friday?.runId).toBe(runId);
    expect(eventsOf(t.daemon, "RunFinished").map((e) => e.runId)).toEqual([runId]);
    expect(ledgerRows(t.daemon).map((r) => r.run_id)).toEqual([runId]);
  });

  it.each([
    ["outside the root", () => "/tmp/fora"],
    ["the worktrees root itself", (root: string) => join(root, "worktrees")],
    [
      "a symbolic link to the outside",
      (root: string) => {
        const outside = mkdtempSync(join(tmpdir(), "friday-outside-"));
        mkdirSync(join(root, "worktrees"), { recursive: true });
        const link = join(root, "worktrees", "link");
        symlinkSync(outside, link);
        return link;
      },
    ],
  ])("refuses a worktree outside the worktrees root (%s)", async (_name, worktreeOf) => {
    const t = await runQa({ worktreeOf });
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(t.daemon)).toBe("QA");
    expect(t.logs.join("\n")).toContain(`O worktreePath ${t.worktree} está fora da raiz do daemon`);
  });

  it.each([
    ["context", { context: () => null }, "A issue 7 em QA não tem contexto para o QA"],
    ["criteria", { criteria: false }, "A issue 7 em QA não tem CriteriaSet válido"],
    ["work report", { report: false }, "A issue 7 em QA não tem WorkReported válido"],
  ] as [string, Over, string][])("logs and skips QA when the %s is missing", async (_n, o, msg) => {
    const t = await runQa(o);
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(t.daemon)).toBe("QA");
    expect(t.logs.join("\n")).toContain(msg);
  });
});
