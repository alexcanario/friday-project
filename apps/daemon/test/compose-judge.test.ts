import { FakeAgentRuntime } from "@friday/application";
import {
  createEventStore,
  createLedgerRepository,
  createRunRepository,
} from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import * as daemonIndex from "../src/index.ts";
import { composeDaemon } from "../src/index.ts";
import { A, eventsOf, put, runJudge, setup, stateOf } from "./compose-judge-helpers.ts";
import { fakeRequest } from "./fakes.ts";
import { FakeReviewer, SharedRuntime } from "./judge-fakes.ts";

describe("composeDaemon with the Judge", () => {
  it("runs the Judge on tick with the review token and the ticker runtime", async () => {
    const t = await runJudge();
    expect(t.createRuntime).toHaveBeenCalledTimes(1);
    expect(t.optsRuntime.calls).toBe(0);
    expect(t.author.ciCalls).toContainEqual([30, "check"]);
    expect((t.runtime as FakeAgentRuntime).requests).toHaveLength(1);
    expect(t.reviewers.map((r) => r.token)).toEqual(["jud9e"]);
    expect(t.reviewers[0]!.posted).toHaveLength(1);
    expect(t.reviewers[0]!.posted[0]!.review.commitId).toBe(A);
    expect(stateOf(t.daemon, 7)).toBe("RiskCheck");
    expect(eventsOf(t.daemon, "RunFinished")).toHaveLength(1);
    const runs = createRunRepository(t.daemon.db).list("p");
    expect(runs.map((r) => r.status)).toEqual(["succeeded"]);
  });

  it("leaves InReview alone without the judge option", async () => {
    const t = await runJudge({ withJudge: false });
    expect(t.optsRuntime.calls).toBe(0);
    expect((t.runtime as FakeAgentRuntime).requests).toHaveLength(0);
    expect(t.author.ciCalls).toHaveLength(0);
    expect(stateOf(t.daemon, 7)).toBe("InReview");
  });

  it("records JudgeSkipped on head mismatch without posting a review", async () => {
    const t = setup();
    t.author.headSha = "b".repeat(40);
    const daemon = await composeDaemon(t.opts);
    put(daemon, 7, "InReview", t.author.headSha);
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
    expect(stateOf(daemon, 7)).toBe("InReview");
    const skipped = eventsOf(daemon, "JudgeSkipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.payload).toMatchObject({
      reason: "head_mismatch",
      headSha: "b".repeat(40),
    });
  });

  it.each([
    { FRIDAY_AUTHOR_TOKEN: "t0k3n" },
    { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_REVIEW_TOKEN: "" },
  ])("logs and keeps InReview when the review token variable is empty", async (env) => {
    const t = await runJudge({ env });
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
    expect(stateOf(t.daemon, 7)).toBe("InReview");
    const text = t.logs.join("\n");
    expect(text).toContain("Falha no Judge da issue 7:");
    expect(text).toContain("A variável de ambiente FRIDAY_REVIEW_TOKEN não está definida.");
    expect(text).not.toContain("t0k3n");
  });

  it("rejects a config without review credential", async () => {
    const t = setup({
      yaml: (y) => y.replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", ""),
    });
    await expect(composeDaemon(t.opts)).rejects.toThrow("O factory.yaml está inválido ou ausente.");
  });

  it("never logs the review token", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    put(daemon, 7, "InReview");
    const post = vi
      .spyOn(FakeReviewer.prototype, "postReview")
      .mockRejectedValue(new Error("401 jud9e"));
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(post).toHaveBeenCalled();
    post.mockRestore();
    const text = t.logs.join("\n");
    expect(text).not.toContain("jud9e");
    expect(text).toContain("***");
    expect(stateOf(daemon, 7)).toBe("InReview");
  });

  it("holds the issue and does not run the Judge above the issue cap", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    createLedgerRepository(daemon.db).record({
      projectId: "p",
      runId: "seed",
      day: "2026-11-05",
      costUsd: 5,
      costUnknown: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      issueId: 7,
      numTurns: null,
    });
    put(daemon, 7, "InReview");
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect((t.runtime as FakeAgentRuntime).requests).toHaveLength(0);
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
    expect(t.author.ciCalls).toHaveLength(1);
    expect(stateOf(daemon, 7)).toBe("Held");
    const held = createEventStore(daemon.db)
      .list("p", 7)
      .filter((e) => e.type === "StateChanged")
      .at(-1);
    expect(held?.payload).toMatchObject({ to: "Held", heldReason: "IssueBudgetExceeded" });
  });

  it("respects maxConcurrentRuns with the composed Judge", async () => {
    const shared = new SharedRuntime();
    const t = setup({ runtime: shared });
    t.author.issues.push({ number: 8, title: "T8", body: "", labels: ["friday"] });
    t.opts.roles = { specialist: (id) => fakeRequest(id) };
    const daemon = await composeDaemon(t.opts);
    put(daemon, 8, "InProgress");
    await daemon.ticker.tick();
    expect(shared.requests).toHaveLength(1);
    put(daemon, 7, "InReview");
    await daemon.ticker.tick();
    expect(shared.requests).toHaveLength(1);
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
    shared.releaseSpecialist();
    await daemon.ticker.idle();
    put(daemon, 8, "Done"); // the specialist finished its work
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(shared.requests).toHaveLength(2);
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(1);
  });

  it("exports the judge wiring from the package index", () => {
    expect(typeof daemonIndex.createJudgeBranch).toBe("function");
  });
});
