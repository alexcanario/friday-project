import { describe, expect, it, vi } from "vitest";
import { judgeContextOf } from "../src/judge-context.ts";
import { runJudgeForIssue } from "../src/judge-dispatch.ts";
import { A, finished, logged, now, setup } from "./judge-dispatch-helpers.ts";

describe("runJudgeForIssue context", () => {
  it("runJudgeForIssue appends criteria and QA report to the run prompt", async () => {
    const t = setup();
    const context = judgeContextOf(t.events.list("p", 7), A, (text) => text);
    expect(context).not.toBeNull();
    await runJudgeForIssue(t.deps, 7);
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.runtime.requests[0]!.prompt).toBe(`judge\n\n${context}`);
    expect(t.runtime.requests[0]!.prompt).toContain('kind="criteria"');
    expect(t.runtime.requests[0]!.prompt).toContain('kind="qa_report"');
  });

  it("runJudgeForIssue fails closed with JudgeSkipped context_missing and does not run again on the same head", async () => {
    const t = setup({ context: false });
    const record = vi.spyOn(t.deps.budget.ledger, "record");
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.runs.rows.size).toBe(0);
    expect(record).not.toHaveBeenCalled();
    const skipped = t.ofType("JudgeSkipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      runId: null,
      payload: { reason: "context_missing", headSha: A },
    });
    expect(logged(t)).toContain(
      `O Judge da issue 7 não roda: faltam os critérios ou o relatório do QA do head ${A}`,
    );
    await runJudgeForIssue(t.deps, 7);
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.ofType("JudgeSkipped")).toHaveLength(1);
  });
});

type T = ReturnType<typeof setup>;
const base = { projectId: "p", issueId: 7, actor: "daemon", at: now().toISOString() };

async function assertFailsClosed(t: T): Promise<void> {
  const record = vi.spyOn(t.deps.budget.ledger, "record");
  await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
  expect(t.runtime.requests).toHaveLength(0);
  expect(t.runs.rows.size).toBe(0);
  expect(record).not.toHaveBeenCalled();
  const skipped = t.ofType("JudgeSkipped");
  expect(skipped).toHaveLength(1);
  expect(skipped[0]).toMatchObject({
    runId: null,
    payload: { reason: "context_missing", headSha: A },
  });
  expect(logged(t)).toContain(
    `O Judge da issue 7 não roda: faltam os critérios ou o relatório do QA do head ${A}`,
  );
  await runJudgeForIssue(t.deps, 7);
  expect(t.runtime.requests).toHaveLength(0);
  expect(t.ofType("JudgeSkipped")).toHaveLength(1);
}

describe("runJudgeForIssue partial context", () => {
  it("runJudgeForIssue fails closed with criteria but no QA report", async () => {
    const t = setup({ context: false });
    const criteria = [{ index: 1, claim: "c", proof: { kind: "command", command: "pnpm test" } }];
    t.events.append({ ...base, runId: null, type: "CriteriaSet", payload: { criteria } });
    await assertFailsClosed(t);
  });

  it("runJudgeForIssue fails closed with a QA report but no criteria", async () => {
    const t = setup({ context: false });
    t.events.append({
      ...base,
      runId: null,
      type: "WorkReported",
      payload: { worktreePath: "/tmp/wt", headSha: A, changedFiles: [] },
    });
    const report = {
      verdict: "pass",
      criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
      notChecked: [],
    };
    t.events.append({ ...base, runId: "qa-1", type: "RunFinished", payload: finished(report) });
    t.events.append({
      ...base,
      runId: "qa-1",
      type: "StateChanged",
      payload: { trigger: "QaPassed", to: "InReview" },
    });
    await assertFailsClosed(t);
  });
});
