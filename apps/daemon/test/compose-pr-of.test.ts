import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentRuntime } from "@friday/application";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { composeDaemon, type ComposeOptions, type Daemon } from "../src/index.ts";
import { fakeWorktrees, fixture, NOW } from "./compose-helpers.ts";
import { FakeClock } from "./fakes.ts";
import { agents, finished, verdict } from "./judge-dispatch-helpers.ts";
import { CountingPendingRuntime, FakeCiGitHub, FakeReviewer } from "./judge-fakes.ts";

const input = () => ({ cwd: "/tmp/wt", prompt: "judge", configRoot: "/tmp/cfg" });

function setup(prOf?: () => number) {
  const root = mkdtempSync(join(tmpdir(), "friday-prof-"));
  cpSync(fixture, root, { recursive: true });
  const author = new FakeCiGitHub();
  author.issues.push({ number: 7, title: "T", body: "- risco: low — x", labels: ["friday"] });
  const logs: string[] = [];
  const opts: ComposeOptions = {
    root,
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_REVIEW_TOKEN: "jud9e" },
    worktrees: fakeWorktrees(),
    runtime: new CountingPendingRuntime(),
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => NOW,
    log: (m) => logs.push(m),
    createGitHub: ((token: string) =>
      token === "t0k3n"
        ? author
        : new FakeReviewer(token)) as unknown as ComposeOptions["createGitHub"],
    createRuntime: () => new FakeAgentRuntime([finished(verdict())]),
    judge: { agents: agents(), input },
    ...(prOf === undefined ? {} : { prOf }),
  };
  return { opts, author, logs };
}

function inReview(daemon: Daemon): void {
  createEventStore(daemon.db).append({
    projectId: "p",
    issueId: 7,
    runId: null,
    type: "StateChanged",
    actor: "daemon",
    at: NOW.toISOString(),
    payload: { to: "InReview", heldReason: null, verifyRound: 0, qaRound: 0, reviewIter: 0 },
  });
  createIssueRepository(daemon.db).rebuild("p");
}

const opened = (daemon: Daemon, number: number) =>
  createEventStore(daemon.db).append({
    projectId: "p",
    issueId: 7,
    runId: null,
    type: "PrOpened",
    actor: "daemon",
    at: NOW.toISOString(),
    payload: { number },
  });

async function tickOnce(daemon: Daemon) {
  await daemon.ticker.tick();
  await daemon.ticker.idle();
}

describe("composeDaemon prOf", () => {
  it("composeDaemon without prOf reads PrOpened from its own database", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    inReview(daemon);
    await tickOnce(daemon);
    expect(t.logs).toContain("A issue 7 em InReview não tem PR associado");
    expect(t.author.ciCalls).toHaveLength(0);
    opened(daemon, 30);
    await tickOnce(daemon);
    expect(t.author.ciCalls.map((c) => c[0])).toContain(30);
  });

  it("composeDaemon keeps an explicit prOf over the database", async () => {
    const t = setup(() => 30);
    const daemon = await composeDaemon(t.opts);
    inReview(daemon);
    opened(daemon, 99);
    await tickOnce(daemon);
    const prs = t.author.ciCalls.map((c) => c[0]);
    expect(prs).toContain(30);
    expect(prs).not.toContain(99);
  });
});
