import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitWorktree, hookNames, stepEnv } from "../src/git-cli-commit.ts";
import { baseEnv, protectedEnv } from "../src/git-worktree-guard.ts";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { configHooksSupported, requireConfigHooks } from "./config-hooks-support.ts";
import { git, makeFixture } from "./worktree-helpers.ts";

const posix = (p: string): string => p.split("\\").join("/");

/** Key/value pairs of the `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` variables, as `key=value`. */
function pairsOfEnv(env: Record<string, string>): string[] {
  const count = Number(env.GIT_CONFIG_COUNT ?? "0");
  return Array.from(
    { length: count },
    (_, i) => `${env[`GIT_CONFIG_KEY_${i}`]}=${env[`GIT_CONFIG_VALUE_${i}`]}`,
  );
}

describe("hook.* handling", { timeout: 30_000 }, () => {
  it("hookNames parses hook.* keys and the protected envs disable each one", async () => {
    expect(
      hookNames(
        "hook.x.command\nhook.x.event\nhook.y.enabled\nhook.my hook.command\nhook.Up.Case.event\ncore.bare\n",
      ),
    ).toEqual(["x", "y", "my hook", "Up.Case"]);
    // An empty subsection (`[hook ""]`) is a hook too; a key without subsection is not.
    expect(hookNames("hook..command\nhook..event\n")).toEqual([""]);
    expect(hookNames("hook.command\n")).toEqual([]);
    const fx = makeFixture();
    git(fx.repoDir, "config", "hook.x.command", "true");
    git(fx.repoDir, "config", "hook.y.enabled", "true");
    git(fx.repoDir, "config", "hook..command", "true");
    const pairs = pairsOfEnv(await protectedEnv(fx.repoDir));
    expect(pairs).toEqual(
      expect.arrayContaining([
        "hook.x.enabled=false",
        "hook.y.enabled=false",
        "hook..enabled=false",
        "core.hooksPath=/dev/null",
        "core.fsmonitor=false",
      ]),
    );
    const step = stepEnv(
      { baseEnv: baseEnv(), worktree: fx.repoDir },
      fx.repoDir,
      fx.root,
      [],
      ["x", ""],
    );
    expect(pairsOfEnv(step)).toContain("hook.x.enabled=false");
    expect(pairsOfEnv(step)).toContain("hook..enabled=false");
  });

  it("commitWorktree runs no config-defined post-commit hook", async (ctx) => {
    requireConfigHooks(configHooksSupported("post-commit", "probe"), () => ctx.skip());
    const fx = makeFixture();
    const created = await new GitWorktreeManager({ repoDir: fx.repoDir }).create({
      root: fx.root,
      project: fx.project,
      issue: 3,
      title: "Hook",
      base: "develop",
    });
    if (!created.ok) throw new Error(created.error.message);
    const worktree = created.value.path;
    mkdirSync(fx.root, { recursive: true });
    const marker = join(fx.root, "hook-marker");
    const positive = join(fx.root, "hook-positive");
    git(fx.repoDir, "config", "hook.mark.event", "post-commit");
    git(fx.repoDir, "config", "hook.mark.command", `touch "${posix(marker)}"; :`);
    const emptyMarker = join(fx.root, "hook-empty-marker");
    git(fx.repoDir, "config", "hook..event", "post-commit");
    git(fx.repoDir, "config", "hook..command", `touch "${posix(emptyMarker)}"; :`);
    const before = git(worktree, "rev-parse", "HEAD");
    writeFileSync(join(worktree, "novo.txt"), "novo\n");
    const out = await commitWorktree({
      git: "git",
      repoDir: fx.repoDir,
      worktree,
      message: "novo",
      baseEnv: baseEnv(),
    });
    expect(out.sha).not.toBe(before);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(emptyMarker), "empty-name hook").toBe(false);
    // Positive check: the same hooks do run on a plain commit.
    git(fx.repoDir, "config", "hook.mark.command", `touch "${posix(positive)}"; :`);
    writeFileSync(join(worktree, "outro.txt"), "outro\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "plain");
    expect(existsSync(positive)).toBe(true);
    expect(existsSync(emptyMarker), "empty-name hook runs on a plain commit").toBe(true);
  });
});
