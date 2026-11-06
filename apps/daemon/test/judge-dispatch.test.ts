import { describe, expect, it, vi } from "vitest";
import { prHeadReader } from "../src/index.ts";
import { runJudgeForIssue } from "../src/judge-dispatch.ts";
import {
  A,
  B,
  TOKEN,
  finished,
  noTokenLeak,
  logged,
  now,
  setup,
  verdict,
} from "./judge-dispatch-helpers.ts";

describe("runJudgeForIssue", () => {
  it("runs the judge, posts the review and applies the outcome", async () => {
    const t = setup();
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: null });
    expect(t.posted).toEqual([expect.objectContaining({ commitId: A, event: "APPROVE" })]);
    expect(t.tokens).toEqual([TOKEN]);
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.ofType("StateChanged")[0]?.payload).toMatchObject({ to: "RiskCheck" });
    expect(t.ofType("JudgeSkipped")).toEqual([]);
    expect(t.ofType("JudgeFinished")).toEqual([]);
    noTokenLeak(t);
  });

  it("records JudgeFinished with the feedback on changes requested", async () => {
    const t = setup({
      results: [finished(verdict({ verdict: "changes_requested", findings: ["x"] }))],
    });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: "1. x" });
    expect(t.ofType("StateChanged")[0]?.payload).toMatchObject({ to: "InProgress" });
    expect(t.ofType("JudgeFinished")).toHaveLength(1);
    expect(t.ofType("JudgeFinished")[0]).toMatchObject({
      actor: "daemon",
      runId: "r1",
      payload: { outcome: "changes_requested", feedback: "1. x", reviewId: 501 },
    });
  });

  it("does not run the judge without a pull request", async () => {
    const t = setup({ pr: null });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(0);
    expect(t.events.appended).toEqual([]);
    expect(t.log).toHaveBeenCalledTimes(1);
  });

  it("does not run the judge without the review token", async () => {
    const t = setup({ env: {} });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.events.appended).toEqual([]);
    expect(t.log).toHaveBeenCalledTimes(1);
    expect(logged(t)).toContain("FRIDAY_REVIEW_TOKEN");
    noTokenLeak(t);
  });

  it("redacts the review token when postReview fails", async () => {
    const t = setup({ postFail: new Error(`falha com ${TOKEN}`) });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.ofType("StateChanged")).toEqual([]);
    expect(t.ofType("JudgeSkipped")).toEqual([]);
    expect(t.ofType("JudgeFinished")).toEqual([]);
    expect(t.issues.row?.state).toBe("InReview");
    expect(logged(t)).toContain("***");
    noTokenLeak(t);
  });

  it("records JudgeSkipped for an invalid or stale verdict", async () => {
    const invalid = setup({ results: [finished({})] });
    await expect(runJudgeForIssue(invalid.deps, 7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(invalid.types()).toEqual(["RunFinished", "JudgeSkipped"]);
    expect(invalid.ofType("JudgeSkipped")[0]).toMatchObject({
      actor: "daemon",
      runId: "r1",
      payload: { reason: "invalid", headSha: A },
    });
    expect(invalid.posted).toHaveLength(0);
    const stale = setup();
    stale.stale.markStale("p", 7, A);
    await runJudgeForIssue(stale.deps, 7);
    expect(stale.ofType("JudgeSkipped")[0]?.payload).toEqual({ reason: "stale", headSha: A });
    expect(stale.posted).toHaveLength(0);
  });

  it("records JudgeSkipped when the pull request head moved", async () => {
    const t = setup({ heads: [A, B] });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.ofType("JudgeSkipped")).toHaveLength(1);
    expect(t.ofType("JudgeSkipped")[0]?.payload).toEqual({ reason: "head_mismatch", headSha: A });
    expect(t.ofType("StateChanged")).toEqual([]);
    expect(t.issues.row?.state).toBe("InReview");
    expect(t.posted).toHaveLength(0);
  });

  it("does not run the judge again for the same head", async () => {
    const same = setup();
    same.events.append({
      projectId: "p",
      issueId: 7,
      runId: "r0",
      type: "JudgeSkipped",
      payload: { reason: "invalid", headSha: A },
      actor: "daemon",
      at: now().toISOString(),
    });
    await expect(runJudgeForIssue(same.deps, 7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(same.runtime.requests).toHaveLength(0);
    expect(same.log).toHaveBeenCalledTimes(1);
    const moved = setup({ heads: [B], results: [finished(verdict({ headSha: B }))] });
    moved.events.append({
      projectId: "p",
      issueId: 7,
      runId: "r0",
      type: "JudgeSkipped",
      payload: { reason: "invalid", headSha: A },
      actor: "daemon",
      at: now().toISOString(),
    });
    await runJudgeForIssue(moved.deps, 7);
    expect(moved.runtime.requests).toHaveLength(1);
  });

  it("reads the pull request head from the check status", async () => {
    const getCiStatus = vi.fn(() => Promise.resolve({ headSha: A, state: "success" as const }));
    await expect(prHeadReader({ getCiStatus })(30)).resolves.toBe(A);
    expect(getCiStatus).toHaveBeenCalledExactlyOnceWith(30, "check");
    const failure = new Error("rede");
    const failing = prHeadReader({ getCiStatus: () => Promise.reject(failure) });
    await expect(failing(30)).rejects.toBe(failure);
  });
});
