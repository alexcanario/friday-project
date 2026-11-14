import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { configHooksSupported, requireConfigHooks } from "./config-hooks-support.ts";
import { git, makeFixture, type Fixture } from "./worktree-helpers.ts";

let fx: Fixture;
let mgr: GitWorktreeManager;
const posix = (p: string): string => p.split("\\").join("/");
const marker = (name: string): string => join(fx.root, `${name}.marker`);
const req = (issue = 31, title = "Contexto") => ({
  root: fx.root,
  project: fx.project,
  issue,
  title,
  base: "develop",
});
const pathOf = (issue = 31): string => join(fx.root, fx.project, String(issue));
const BRANCH = "friday/31-contexto";

beforeEach(() => {
  fx = makeFixture();
  mgr = new GitWorktreeManager({ repoDir: fx.repoDir });
  mkdirSync(fx.root, { recursive: true });
  // `.gitattributes` committed on the base: every file goes through the `probe` filter.
  git(fx.repoDir, "checkout", "-q", "develop");
  writeFileSync(join(fx.repoDir, ".gitattributes"), "* filter=probe\n");
  git(fx.repoDir, "add", ".");
  git(fx.repoDir, "commit", "-q", "-m", "attributes");
  git(fx.repoDir, "push", "-q", "origin", "develop");
  git(fx.repoDir, "checkout", "-q", "main");
});

/** Writes `<name>.inc` with `entries` (via `git config --file`) and includes it under `condition`. */
function includeIf(condition: string, entries: [string, string][]): void {
  const file = join(fx.root, "included.inc");
  for (const [key, value] of entries) git(fx.repoDir, "config", "--file", file, key, value);
  git(fx.repoDir, "config", `includeIf.${condition}.path`, posix(file));
}

const smudge = (name: string): [string, string][] => [
  ["filter.probe.smudge", `sh -c 'touch "${posix(marker(name))}"; cat'`],
  ["filter.probe.required", "false"],
];

function expectCleanWorktree(path: string): void {
  expect(existsSync(join(path, "a.txt"))).toBe(true);
  expect(git(path, "status", "--porcelain")).toBe("");
}

function hookEntries(): [string, string][] {
  const touch = (n: string): string => `touch "${posix(marker(n))}"; :`;
  return [
    ["hook.probe.event", "post-checkout"],
    ["hook.probe.command", touch("probe")],
    ["hook.rt.event", "reference-transaction"],
    ["hook.rt.command", touch("rt")],
  ];
}

/** Unprotected control: a plain `worktree add --no-checkout` of a new branch, as git would run it. */
function plainAdd(path: string): void {
  git(
    fx.repoDir,
    "worktree",
    "add",
    "-q",
    "--no-checkout",
    "-b",
    "friday/ctl",
    path,
    "origin/develop",
  );
}

describe(
  "GitWorktreeManager.create reads protections in the worktree context",
  {
    timeout: 60_000,
  },
  () => {
    it("create runs no filter defined under includeIf onbranch (new branch)", async () => {
      includeIf("onbranch:friday/**", smudge("smudge"));
      const created = await mgr.create(req());
      expect(created.ok).toBe(true);
      expect(existsSync(marker("smudge"))).toBe(false);
      expectCleanWorktree(pathOf());
      expect(git(pathOf(), "rev-parse", "HEAD")).toBe(
        git(fx.repoDir, "rev-parse", "origin/develop"),
      );
      git(
        fx.repoDir,
        "worktree",
        "add",
        "-q",
        "-b",
        "friday/ctl",
        join(fx.root, "ctl"),
        "origin/develop",
      );
      expect(existsSync(marker("smudge"))).toBe(true);
    });

    it("create runs no filter defined under includeIf gitdir", async () => {
      includeIf("gitdir:**/worktrees/", smudge("smudge"));
      const created = await mgr.create(req());
      expect(created.ok).toBe(true);
      expect(existsSync(marker("smudge"))).toBe(false);
      expectCleanWorktree(pathOf());
      git(
        fx.repoDir,
        "worktree",
        "add",
        "-q",
        "-b",
        "friday/ctl",
        join(fx.root, "ctl"),
        "origin/develop",
      );
      expect(existsSync(marker("smudge"))).toBe(true);
    });

    it("create runs no includeIf filter when the branch already exists", async () => {
      includeIf("onbranch:friday/**", smudge("smudge"));
      expect((await mgr.create(req())).ok).toBe(true);
      rmSync(pathOf(), { recursive: true, force: true });
      // Positive check: a plain `worktree add` of the existing branch runs the filter.
      git(fx.repoDir, "worktree", "prune");
      const plain = join(fx.root, "plain");
      git(fx.repoDir, "worktree", "add", "-q", plain, BRANCH);
      expect(existsSync(marker("smudge"))).toBe(true);
      rmSync(plain, { recursive: true, force: true });
      rmSync(marker("smudge"));
      git(fx.repoDir, "worktree", "prune");

      const again = await mgr.create(req());
      expect(again.ok).toBe(true);
      expect(existsSync(marker("smudge"))).toBe(false);
      expectCleanWorktree(pathOf());
    });

    it("create runs no includeIf config hook (new and reused branch)", async ({ skip }) => {
      includeIf("onbranch:friday/**", hookEntries());
      const ctl = join(fx.root, "ctl");
      git(
        fx.repoDir,
        "worktree",
        "add",
        "-q",
        "--no-checkout",
        ctl,
        "-b",
        "friday/ctl",
        "origin/develop",
      );
      requireConfigHooks(configHooksSupported("post-checkout", "probe"), () => skip());
      for (const name of ["probe", "rt"]) rmSync(marker(name), { force: true });

      expect((await mgr.create(req())).ok).toBe(true);
      rmSync(pathOf(), { recursive: true, force: true });
      expect((await mgr.create(req())).ok).toBe(true);
      expect(existsSync(marker("probe"))).toBe(false);
      expect(existsSync(marker("rt"))).toBe(false);

      git(ctl, "checkout", "--force", "HEAD");
      expect(existsSync(marker("probe"))).toBe(true);
      expect(existsSync(marker("rt"))).toBe(true);
    });

    it("create runs no includeIf gitdir config hook matching the main gitdir (new and reused branch)", async ({
      skip,
    }) => {
      includeIf("gitdir:**/.git", hookEntries());
      requireConfigHooks(configHooksSupported("post-checkout", "probe"), () => skip());
      plainAdd(join(fx.root, "ctl"));
      expect(existsSync(marker("rt"))).toBe(true);
      rmSync(marker("rt"));

      expect((await mgr.create(req())).ok).toBe(true);
      rmSync(pathOf(), { recursive: true, force: true });
      expect((await mgr.create(req())).ok).toBe(true);
      expect(existsSync(marker("rt"))).toBe(false);
      expect(existsSync(marker("probe"))).toBe(false);
    });

    it("create runs no includeIf gitdir config hook matching only the worktree gitdir", async ({
      skip,
    }) => {
      includeIf("gitdir:**/worktrees/", hookEntries());
      const ctl = join(fx.root, "ctl");
      plainAdd(ctl);
      requireConfigHooks(configHooksSupported("post-checkout", "probe"), () => skip());

      const created = await mgr.create(req());
      expect(created.ok).toBe(true);
      for (const name of ["probe", "rt"]) expect(existsSync(marker(name))).toBe(false);
      expect(git(pathOf(), "status", "--porcelain")).toBe("");

      git(ctl, "checkout", "--force", "HEAD");
      expect(existsSync(marker("probe"))).toBe(true);
    });

    it("alignTo runs no includeIf filter on detach (regression guard)", async () => {
      includeIf("onbranch:friday/**", smudge("smudge"));
      expect((await mgr.create(req())).ok).toBe(true);
      const control = join(fx.root, "ctl");
      const other = join(fx.root, "ctl2");
      git(
        fx.repoDir,
        "worktree",
        "add",
        "-q",
        "--no-checkout",
        control,
        "-b",
        "friday/ctl",
        "origin/develop",
      );
      git(
        fx.repoDir,
        "worktree",
        "add",
        "-q",
        "--no-checkout",
        other,
        "-b",
        "friday/ctl2",
        "origin/develop",
      );
      for (const dir of [control, other]) {
        git(dir, "-c", "filter.probe.smudge=", "checkout", "--force", "HEAD");
      }
      writeFileSync(join(control, "a.txt"), "changed\n");
      git(
        control,
        "-c",
        "user.email=t@t.t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-a",
        "-m",
        "change",
      );
      const sha = git(control, "rev-parse", "HEAD");
      git(control, "push", "-q", "origin", "friday/ctl");
      rmSync(marker("smudge"), { force: true });

      const aligned = await mgr.alignTo(pathOf(), sha);
      expect(aligned.ok).toBe(true);
      expect(git(pathOf(), "rev-parse", "HEAD")).toBe(sha);
      expect(existsSync(marker("smudge"))).toBe(false);
      git(other, "checkout", "--detach", sha);
      expect(existsSync(marker("smudge"))).toBe(true);
    });

    it("create fails and leaves no worktree when a step after add fails", async () => {
      const broken = join(mkdtempSync(join(tmpdir(), "friday-broken-")), "broken.inc");
      writeFileSync(broken, "[broken\n");
      git(fx.repoDir, "config", "includeIf.onbranch:friday/**.path", posix(broken));
      const created = await mgr.create(req());
      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error.code).toBe("WorktreeCreateFailed");
      expect(existsSync(pathOf())).toBe(false);
      expect(git(fx.repoDir, "worktree", "list", "--porcelain")).not.toContain(posix(pathOf()));
    });
  },
);
