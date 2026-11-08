import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentRuntime, type AgentRuntime, type GitHubPort } from "@friday/application";
import {
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
} from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import * as daemonIndex from "../src/index.ts";
import { composeDaemon, type ComposeOptions, type Daemon } from "../src/index.ts";
import { fakeWorktrees, fixture, NOW } from "./compose-helpers.ts";
import { FakeClock, fakeRequest } from "./fakes.ts";
import { agents, finished, verdict } from "./judge-dispatch-helpers.ts";
import { CountingPendingRuntime, FakeCiGitHub, FakeReviewer, SharedRuntime } from "./judge-fakes.ts";

const A = "a".repeat(40);
const input = () => ({ cwd: "/tmp/wt", prompt: "judge", configRoot: "/tmp/cfg" });

type Over = {
  yaml?: (y: string) => string;
  env?: Record<string, string | undefined>;
  withJudge?: boolean;
  runtime?: AgentRuntime;
};

function setup(o: Over = {}) {
  const root = mkdtempSync(join(tmpdir(), "friday-judge-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    "  merge: manual\n",
    "  merge: manual\n  author_token_env: FRIDAY_AUTHOR_TOKEN\n  review_token_env: FRIDAY_REVIEW_TOKEN\n",
  );
  writeFileSync(file, (o.yaml ?? ((y) => y))(yaml));
  const author = new FakeCiGitHub();
  author.issues.push({ number: 7, title: "T", body: "- risco: low — x", labels: ["friday"] });
  const reviewers: FakeReviewer[] = [];
  const logs: string[] = [];
  const runtime = o.runtime ?? new FakeAgentRuntime([finished(verdict())]);
  const optsRuntime = new CountingPendingRuntime();
  const createRuntime = vi.fn(() => runtime);
  const createGitHub = vi.fn((token: string) => {
    if (token === "t0k3n") return author as unknown as GitHubPort;
    const reviewer = new FakeReviewer(token);
    reviewers.push(reviewer);
    return reviewer as unknown as GitHubPort;
  });
  const opts: ComposeOptions = {
    root,
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: o.env ?? { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_REVIEW_TOKEN: "jud9e" },
    worktrees: fakeWorktrees(),
    runtime: optsRuntime,
    prOf: () => 30,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => NOW,
    log: (m) => logs.push(m),
    createGitHub: createGitHub as unknown as ComposeOptions["createGitHub"],
    createRuntime,
    ...(o.withJudge === false ? {} : { judge: { agents: agents(), input } }),
  };
  return { root, opts, author, reviewers, logs, runtime, optsRuntime, createRuntime };
}

function put(daemon: Daemon, issueId: number, to: string): void {
  createEventStore(daemon.db).append({
    projectId: "p",
    issueId,
    runId: null,
    type: "StateChanged",
    actor: "daemon",
    at: NOW.toISOString(),
    payload: { to, heldReason: null, verifyRound: 0, qaRound: 0, reviewIter: 0 },
  });
  createIssueRepository(daemon.db).rebuild("p");
}

const stateOf = (d: Daemon, id: number) => createIssueRepository(d.db).get("p", id)?.state;
const eventsOf = (d: Daemon, type: string) =>
  createEventStore(d.db)
    .list("p", 7)
    .filter((e) => e.type === type);

async function runJudge(o: Over = {}) {
  const t = setup(o);
  const daemon = await composeDaemon(t.opts);
  put(daemon, 7, "InReview");
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  return { ...t, daemon };
}

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
    put(daemon, 7, "InReview");
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
    expect(stateOf(daemon, 7)).toBe("InReview");
    const skipped = eventsOf(daemon, "JudgeSkipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.payload).toMatchObject({ reason: "head_mismatch", headSha: A });
  });

  it.each([{ FRIDAY_AUTHOR_TOKEN: "t0k3n" }, { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_REVIEW_TOKEN: "" }])(
    "logs and keeps InReview when the review token variable is empty",
    async (env) => {
      const t = await runJudge({ env });
      expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
      expect(stateOf(t.daemon, 7)).toBe("InReview");
      const text = t.logs.join("\n");
      expect(text).toContain("Falha no Judge da issue 7:");
      expect(text).toContain("A variável de ambiente FRIDAY_REVIEW_TOKEN não está definida.");
      expect(text).not.toContain("t0k3n");
    },
  );

  it("logs when review_token_env is missing without failing the startup", async () => {
    const t = await runJudge({ yaml: (y) => y.replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", "") });
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
    expect(t.logs.join("\n")).toContain("A chave pull_requests.review_token_env não está configurada.");
  });

  it("never logs the review token", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    const original = t.opts.createGitHub!;
    void original;
    put(daemon, 7, "InReview");
    // make every reviewer reject with the token inside the message
    t.createRuntime.mockImplementation(() => t.runtime);
    const post = vi
      .spyOn(FakeReviewer.prototype, "postReview")
      .mockRejectedValue(new Error("401 jud9e"));
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    post.mockRestore();
    const text = t.logs.join("\n");
    expect(post).toHaveBeenCalled();
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
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(shared.requests).toHaveLength(2);
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(1);
  });

  it("exports the judge wiring from the package index", () => {
    expect(typeof daemonIndex.createJudgeBranch).toBe("function");
  });
});
