import { describe, expect, it, vi } from "vitest";
import type { IssueRow, StoredEvent } from "@friday/application";
import * as daemon from "../src/index.ts";
import { feedbackOf } from "../src/index.ts";
import { runVerifyForIssue, verifyTargetOf, type VerifyDispatchDeps } from "../src/verify-dispatch.ts";
import type { VerifyStepOutcome } from "../src/verify-step.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const SHA = "a".repeat(40);
const now = () => new Date("2026-11-05T03:00:00.000Z");
const work = { worktreePath: "/tmp/wt", headSha: SHA, changedFiles: ["src/A.cs"] };

const stored = (seq: number, type: string, payload: unknown): StoredEvent => ({
  seq,
  projectId: "p",
  issueId: 7,
  runId: "r0",
  type,
  payload,
  actor: "daemon",
  at: "2026-11-05T03:00:00.000Z",
});

function setup(o: { state?: string; verifyRound?: number; noRow?: boolean; noWork?: boolean } = {}) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  if (!o.noRow) {
    const row: IssueRow = {
      projectId: "p",
      issueId: 7,
      state: o.state ?? "Verify",
      heldReason: null,
      verifyRound: o.verifyRound ?? 0,
      qaRound: 0,
      reviewIter: 0,
    };
    issues.rows.set(7, row);
  }
  if (!o.noWork) {
    events.append({
      projectId: "p",
      issueId: 7,
      runId: "r0",
      type: "WorkReported",
      payload: work,
      actor: "daemon",
      at: "2026-11-05T03:00:00.000Z",
    });
  }
  return { events, issues };
}

function deps(t: ReturnType<typeof setup>, outcome: VerifyStepOutcome | Error) {
  const step = vi.fn<VerifyDispatchDeps["step"]>(() =>
    outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
  );
  const log = vi.fn<(m: string) => void>();
  const d: VerifyDispatchDeps = {
    projectId: "p",
    recorder: { projectId: "p", events: t.events, issues: t.issues, now },
    step,
    log,
  };
  return { d, step, log };
}

const types = (t: ReturnType<typeof setup>) => t.events.list("p", 7).map((e) => e.type);

describe("verify dispatch", () => {
  it("verifyTargetOf returns the latest valid WorkReported or null", () => {
    expect(verifyTargetOf([stored(1, "WorkReported", work)])).toEqual({
      worktreePath: "/tmp/wt",
      headSha: SHA,
    });
    expect(
      verifyTargetOf([
        stored(1, "WorkReported", { ...work, worktreePath: "/tmp/old" }),
        stored(3, "WorkReported", work),
        stored(4, "QaFinished", {}),
      ]),
    ).toEqual({ worktreePath: "/tmp/wt", headSha: SHA });
    expect(verifyTargetOf([])).toBeNull();
    expect(verifyTargetOf([stored(1, "StateChanged", {})])).toBeNull();
    for (const bad of [
      { ...work, headSha: "a".repeat(39) },
      { ...work, headSha: "Z".repeat(40) },
      { ...work, worktreePath: "" },
      { ...work, changedFiles: "x" },
      null,
    ]) {
      expect(verifyTargetOf([stored(1, "WorkReported", bad)])).toBeNull();
    }
  });

  it("moves to QA on VerifyPassed with the latest WorkReported", async () => {
    const t = setup();
    t.events.append({
      projectId: "p",
      issueId: 7,
      runId: "r0",
      type: "WorkReported",
      payload: { ...work, worktreePath: "/tmp/newer" },
      actor: "daemon",
      at: "2026-11-05T03:00:00.000Z",
    });
    const { d, step } = deps(t, { input: { type: "VerifyPassed" } });
    await expect(runVerifyForIssue(d, 7)).resolves.toEqual({ applied: true, feedback: null });
    expect(step).toHaveBeenCalledExactlyOnceWith({ worktreePath: "/tmp/newer", headSha: SHA });
    expect(types(t)).toEqual(["WorkReported", "WorkReported", "StateChanged"]);
    const changed = t.events.list("p", 7)[2]!;
    expect(changed.runId).toBeNull();
    expect(changed.payload).toMatchObject({ from: "Verify", to: "QA", trigger: "VerifyPassed" });
    expect(t.issues.rebuilds).toHaveLength(1);
  });

  it("returns to InProgress and records VerifyFinished with the feedback, also on the last round", async () => {
    const t = setup({ verifyRound: 0 });
    const failed: VerifyStepOutcome = { input: { type: "VerifyFailed" }, feedback: "boom" };
    await expect(runVerifyForIssue(deps(t, failed).d, 7)).resolves.toEqual({
      applied: true,
      feedback: "boom",
    });
    expect(types(t)).toEqual(["WorkReported", "StateChanged", "VerifyFinished"]);
    const [, changed, finished] = t.events.list("p", 7);
    expect(changed!.payload).toMatchObject({ to: "InProgress", verifyRound: 1 });
    expect(finished!.payload).toEqual({ outcome: "verify_failed", feedback: "boom" });
    expect(finished).toMatchObject({
      actor: "daemon",
      runId: null,
      issueId: 7,
      at: "2026-11-05T03:00:00.000Z",
    });

    const last = setup({ verifyRound: 2 });
    await runVerifyForIssue(deps(last, failed).d, 7);
    expect(last.events.list("p", 7)[1]!.payload).toMatchObject({
      to: "Held",
      heldReason: "VerifyRoundsExhausted",
      verifyRound: 3,
    });
    expect(types(last)).toContain("VerifyFinished");
  });

  it("holds on timeout, head change and misconfiguration without VerifyFinished", async () => {
    const cases: [VerifyStepOutcome, string][] = [
      [{ input: { type: "VerifyTimedOut" } }, "VerifyTimeout"],
      [{ input: { type: "VerifyHeadChanged" } }, "HeadChanged"],
      [{ input: { type: "RunHeld", reason: "RunMisconfigured" } }, "RunMisconfigured"],
    ];
    for (const [outcome, reason] of cases) {
      const t = setup();
      await expect(runVerifyForIssue(deps(t, outcome).d, 7)).resolves.toEqual({
        applied: true,
        feedback: null,
      });
      expect(types(t)).toEqual(["WorkReported", "StateChanged"]);
      expect(t.events.list("p", 7)[1]!.payload).toMatchObject({ to: "Held", heldReason: reason });
    }
  });

  it("applies nothing and never rejects for a missing row, wrong state, missing report or a throwing step", async () => {
    const pass: VerifyStepOutcome = { input: { type: "VerifyPassed" } };
    const cases: [ReturnType<typeof setup>, VerifyStepOutcome | Error, boolean][] = [
      [setup({ noRow: true }), pass, false],
      [setup({ state: "QA" }), pass, false],
      [setup({ noWork: true }), pass, false],
      [setup(), new Error("boom"), true],
    ];
    for (const [t, outcome, called] of cases) {
      const { d, step, log } = deps(t, outcome);
      await expect(runVerifyForIssue(d, 7)).resolves.toEqual({ applied: false, feedback: null });
      expect(step).toHaveBeenCalledTimes(called ? 1 : 0);
      expect(log).toHaveBeenCalled();
      expect(t.events.list("p", 7).filter((e) => e.type !== "WorkReported")).toEqual([]);
      expect(t.issues.rebuilds).toEqual([]);
      if (called) expect(log.mock.calls[0]![0]).toContain("boom");
    }
  });

  it("feedbackOf of the specialist reads the recorded VerifyFinished", async () => {
    const t = setup();
    await runVerifyForIssue(
      deps(t, { input: { type: "VerifyFailed" }, feedback: "boom" }).d,
      7,
    );
    expect(feedbackOf(t.events.list("p", 7))).toBe("boom");
  });

  it("is exported by the package index", () => {
    expect(daemon.runVerifyForIssue).toBe(runVerifyForIssue);
    expect(daemon.verifyTargetOf).toBe(verifyTargetOf);
  });
});
