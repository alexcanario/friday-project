import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { composeDaemon } from "../src/index.ts";
import { NOW, setup } from "./compose-helpers.ts";

describe("composeDaemon release", () => {
  it("closes the database even when releasing the lock throws", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    const lockFile = join(t.root, ".friday", "daemon.lock");
    rmSync(lockFile, { force: true });
    mkdirSync(lockFile);
    writeFileSync(join(lockFile, "inner.txt"), "x");
    expect(() => daemon.release()).toThrow();
    expect(daemon.db.sqlite.open).toBe(false);
  });

  it("releases the lock and closes the database on a clean release", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    expect(() => daemon.release()).not.toThrow();
    expect(daemon.db.sqlite.open).toBe(false);
    expect(existsSync(join(t.root, ".friday", "daemon.lock"))).toBe(false);
  });

  it("passes worktreesRoot to the verify branch", async () => {
    const t = setup();
    t.github.issues.push({ number: 7, title: "T", body: "", labels: ["friday"] });
    const daemon = await composeDaemon({ ...t.opts, worktreesRoot: join(t.root, "worktrees") });
    const worktreePath = join(t.root, "repos", "x");
    mkdirSync(worktreePath, { recursive: true });
    const at = NOW.toISOString();
    const events = createEventStore(daemon.db);
    events.append({
      projectId: "p",
      issueId: 7,
      runId: null,
      type: "StateChanged",
      actor: "daemon",
      at,
      payload: {
        type: "StateChanged",
        issueId: "7",
        from: "InProgress",
        to: "Verify",
        trigger: "WorkReported",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
    events.append({
      projectId: "p",
      issueId: 7,
      runId: null,
      type: "WorkReported",
      actor: "daemon",
      at,
      payload: { worktreePath, headSha: "a".repeat(40), changedFiles: ["a.txt"] },
    });
    createIssueRepository(daemon.db).rebuild("p");
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    const row = createIssueRepository(daemon.db).get("p", 7);
    daemon.release();
    expect(row?.state).toBe("Held");
    expect(row?.heldReason).toBe("RunMisconfigured");
  });
});
