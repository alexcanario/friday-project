import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVerifyBranch, isInsideRoot } from "../src/index.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const SHA = "a".repeat(40);
const FIXTURE = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const BASE_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

/** A repository with one commit at `repoDir` and a linked worktree at `worktree`; returns its HEAD. */
function linkedWorktree(repoDir: string, worktree: string, message: string): string {
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, "init", "-q", "-b", "main");
  git(repoDir, "commit", "-q", "--allow-empty", "-m", message);
  git(repoDir, "worktree", "add", "-q", "-b", `friday/${message}`, worktree);
  return git(worktree, "rev-parse", "HEAD");
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "verify-wiring-"));
}

function registry(command: string): string {
  const root = tmp();
  cpSync(FIXTURE, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    /verify:\r?\n {2}command: .*\r?\n {2}timeout_s: .*\r?\n/,
    `verify:\n  command: ${JSON.stringify(command)}\n  timeout_s: 60\n`,
  );
  writeFileSync(file, yaml);
  return root;
}

async function run(
  command: string,
  options: {
    worktree?: (root: string) => string;
    env?: Record<string, string | undefined>;
    worktreesRoot?: (root: string) => string;
    /** Real linked worktree: no `readHead`, so the default reader runs with `repoDir`. */
    real?: (root: string, worktreePath: string) => string;
  } = {},
) {
  const root = registry(command);
  const worktreePath = options.worktree?.(root) ?? join(root, "worktrees", "7");
  const headSha = options.real?.(root, worktreePath) ?? SHA;
  if (options.real === undefined) mkdirSync(worktreePath, { recursive: true });
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  issues.rows.set(7, {
    projectId: "p",
    issueId: 7,
    state: "Verify",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  });
  events.append({
    projectId: "p",
    issueId: 7,
    runId: "r0",
    type: "WorkReported",
    payload: { worktreePath, headSha, changedFiles: ["src/A.cs"] },
    actor: "daemon",
    at: "2026-11-05T03:00:00.000Z",
  });
  const logs: string[] = [];
  const branch = createVerifyBranch({
    projectId: "p",
    recorder: { projectId: "p", events, issues, now: () => new Date("2026-11-05T03:00:00.000Z") },
    root,
    ...(options.worktreesRoot === undefined ? {} : { worktreesRoot: options.worktreesRoot(root) }),
    env: options.env ?? BASE_ENV,
    repoDir: join(root, "repos", "r"),
    ...(options.real === undefined ? { readHead: async () => SHA } : {}),
    log: (m) => logs.push(m),
  });
  const result = await branch(7);
  return { result, row: issues.rows.get(7), logs, worktreePath, root };
}

describe("isInsideRoot", () => {
  it("accepts children and refuses root, parent, sibling prefix, outside, relative and symlinked paths", () => {
    const base = tmp();
    const root = join(base, "r");
    mkdirSync(join(root, "p", "7"), { recursive: true });
    mkdirSync(join(base, "fora"));
    mkdirSync(join(base, "r-evil", "7"), { recursive: true });
    symlinkSync(join(base, "fora"), join(root, "link"), "junction");
    expect(isInsideRoot(root, join(root, "p", "7"))).toBe(true);
    expect(isInsideRoot(root, root)).toBe(false);
    expect(isInsideRoot(root, join(root, "..", "x"))).toBe(false);
    expect(isInsideRoot(root, join(base, "r-evil", "7"))).toBe(false);
    expect(isInsideRoot(root, join(base, "fora"))).toBe(false);
    expect(isInsideRoot(root, join("p", "7"))).toBe(false);
    expect(isInsideRoot(root, join(root, "link"))).toBe(false);
  });
});

describe("createVerifyBranch", () => {
  it("passes Verify to QA with the real step and registry command", async () => {
    const t = await run(`node -e "process.exit(0)"`);
    expect(t.result.applied).toBe(true);
    expect(t.row?.state).toBe("QA");
  });

  it("returns to InProgress with the command tail as feedback on failure", async () => {
    const t = await run(`node -e "console.log('boom'); process.exit(1)"`);
    expect(t.result.applied).toBe(true);
    expect(t.result.feedback).toContain("boom");
    expect(t.row?.state).toBe("InProgress");
  });

  it("holds the issue with RunMisconfigured for a worktreePath outside the root without running the command", async () => {
    const command = `node -e "require('fs').writeFileSync('marker','x')"`;
    for (const pick of [
      (root: string) => join(root, "..", "fora-" + Math.random().toString(36).slice(2)),
      (root: string) => `${root}-evil`,
    ]) {
      const t = await run(command, { worktree: pick });
      expect(existsSync(join(t.worktreePath, "marker"))).toBe(false);
      expect(t.row?.state).toBe("Held");
      expect(t.row?.heldReason).toBe("RunMisconfigured");
      expect(t.logs.some((m) => m.includes("fora da raiz"))).toBe(true);
    }
  });

  it("confines the worktree path to worktreesRoot (accepts worktrees/7)", async () => {
    const t = await run(`node -e "process.exit(0)"`, {
      worktreesRoot: (root) => join(root, "worktrees"),
    });
    expect(t.row?.state).toBe("QA");
  });

  it("confines the worktree path to worktreesRoot", async () => {
    const command = `node -e "require('fs').writeFileSync('marker','x')"`;
    for (const sub of [[".friday"], ["repos", "x"], ["worktrees"]]) {
      const t = await run(command, {
        worktree: (root) => join(root, ...sub),
        worktreesRoot: (root) => join(root, "worktrees"),
      });
      expect(existsSync(join(t.worktreePath, "marker"))).toBe(false);
      expect(t.row?.state).toBe("Held");
      expect(t.row?.heldReason).toBe("RunMisconfigured");
      expect(t.logs).toContain(`O worktreePath ${t.worktreePath} está fora da raiz do daemon`);
    }
  });

  it("accepts a worktree under worktreesRoot/owner__repo/issue and refuses one outside", async () => {
    const command = `node -e "process.exit(0)"`;
    const worktreesRoot = (root: string) => join(root, "worktrees");
    const inside = await run(command, {
      worktree: (root) => join(root, "worktrees", "acme__widgets", "7"),
      worktreesRoot,
    });
    expect(inside.row?.state).toBe("QA");
    const outside = await run(command, {
      worktree: (root) => join(root, "repos", "acme__widgets", "7"),
      worktreesRoot,
    });
    expect(outside.row?.state).toBe("Held");
    expect(outside.row?.heldReason).toBe("RunMisconfigured");
  });

  it("strips ANTHROPIC_API_KEY from the command environment in any case", async () => {
    const command = `node -e "process.exit(process.env.ANTHROPIC_API_KEY || process.env.anthropic_api_key ? 1 : 0)"`;
    const t = await run(command, {
      env: { ...BASE_ENV, ANTHROPIC_API_KEY: "x", anthropic_api_key: "y" },
    });
    expect(t.row?.state).toBe("QA");
  });

  it("the default readHead reads the real HEAD with repoDir", async () => {
    const marker = `node -e "require('fs').writeFileSync('marker','x')"`;
    const ok = await run(marker, {
      worktreesRoot: (root) => join(root, "worktrees"),
      real: (root, worktree) => linkedWorktree(join(root, "repos", "r"), worktree, "ok"),
    });
    expect(ok.row?.state).toBe("QA");
    expect(existsSync(join(ok.worktreePath, "marker"))).toBe(true);

    const forged = await run(marker, {
      worktreesRoot: (root) => join(root, "worktrees"),
      real: (root, worktree) => {
        const head = linkedWorktree(join(root, "repos", "r"), worktree, "mine");
        const otherDir = join(root, "outro");
        linkedWorktree(otherDir, join(root, "outro-wt"), "other");
        const foreign = join(otherDir, ".git", "worktrees", "outro-wt");
        rmSync(join(worktree, ".git"));
        writeFileSync(
          join(worktree, ".git"),
          `gitdir: ${foreign}
`,
        );
        return head;
      },
    });
    expect(forged.result.applied).toBe(false);
    expect(existsSync(join(forged.worktreePath, "marker"))).toBe(false);
  });
});
