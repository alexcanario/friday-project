import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { composeDaemon } from "../src/index.ts";
import { NOW, setup } from "./compose-helpers.ts";

function withCommand(command: string) {
  return (yaml: string) =>
    yaml.replace(
      /verify:\r?\n {2}command: .*\r?\n {2}timeout_s: .*\r?\n/,
      `verify:\n  command: ${JSON.stringify(command)}\n  timeout_s: 60\n`,
    );
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

/** The daemon repository (one commit) at `repoDir` and a linked worktree at `path`; returns its HEAD. */
function gitRepo(repoDir: string, path: string): string {
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, "init", "-q");
  git(repoDir, "commit", "-q", "--allow-empty", "-m", "init");
  git(repoDir, "worktree", "add", "-q", "-b", "friday/7", path);
  return git(path, "rev-parse", "HEAD");
}

async function scenario(command: string, worktree: (root: string) => string) {
  const t = setup(withCommand(command));
  t.github.issues.push({ number: 7, title: "T", body: "", labels: ["friday"] });
  const repoDir = join(t.root, "repos", "p__r");
  const daemon = await composeDaemon({ ...t.opts, repoDir });
  const worktreePath = worktree(t.root);
  const headSha = gitRepo(repoDir, worktreePath);
  const at = NOW.toISOString();
  createEventStore(daemon.db).append({
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
  createEventStore(daemon.db).append({
    projectId: "p",
    issueId: 7,
    runId: null,
    type: "WorkReported",
    actor: "daemon",
    at,
    payload: { worktreePath, headSha, changedFiles: ["a.txt"] },
  });
  createIssueRepository(daemon.db).rebuild("p");
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  const row = createIssueRepository(daemon.db).get("p", 7);
  daemon.release();
  return { row, worktreePath };
}

describe("composeDaemon verify wiring", () => {
  it("composeDaemon moves an issue from Verify to QA on tick", async () => {
    const t = await scenario(`node -e "process.exit(0)"`, (root) => join(root, "worktrees", "7"));
    expect(t.row?.state).toBe("QA");
  });

  it("composeDaemon holds an issue whose worktreePath is outside the root", async () => {
    const outside = mkdtempSync(join(tmpdir(), "friday-outside-"));
    const t = await scenario(`node -e "require('fs').writeFileSync('marker','x')"`, () => outside);
    expect(existsSync(join(t.worktreePath, "marker"))).toBe(false);
    expect(t.row?.state).toBe("Held");
    expect(t.row?.heldReason).toBe("RunMisconfigured");
  });
});
