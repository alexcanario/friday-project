import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { GitWorktreeManager } from "../src/index.ts";
import { git, makeFixture } from "./worktree-helpers.ts";

/** Repo whose develop holds eol.txt (LF) and changed.txt, with global autocrlf=true, plus a manager-made worktree. */
export async function makeEolScenario(): Promise<{ repoDir: string; worktree: string }> {
  const fx = makeFixture();
  const cfgDir = mkdtempSync(join(tmpdir(), "friday-eol-cfg-"));
  const cfg = join(cfgDir, "gitconfig");
  writeFileSync(cfg, "[core]\n\tautocrlf = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", cfg);
  git(fx.repoDir, "checkout", "develop");
  writeFileSync(join(fx.repoDir, "eol.txt"), "a\nb\n");
  writeFileSync(join(fx.repoDir, "changed.txt"), "velho\n");
  git(fx.repoDir, "add", "eol.txt", "changed.txt");
  git(fx.repoDir, "commit", "-m", "eol");
  git(fx.repoDir, "push", "origin", "develop");
  git(fx.repoDir, "checkout", "main");
  const res = await new GitWorktreeManager({ repoDir: fx.repoDir }).create({
    root: fx.root,
    project: fx.project,
    issue: 361,
    title: "eol",
    base: "develop",
  });
  if (!res.ok) throw new Error(res.error.message);
  return { repoDir: fx.repoDir, worktree: res.value.path };
}
