import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitWorktree, hookNames, stepEnv } from "../src/git-cli-commit.ts";
import { baseEnv, protectedEnv } from "../src/git-worktree-guard.ts";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
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

/** True when this git runs config-defined hooks and lists `name` for `event`. */
function supportsConfigHooks(event: string, name: string): boolean {
  try {
    const dir = mkdtempSync(join(tmpdir(), "friday-hook-probe-"));
    git(dir, "init", "-q");
    git(dir, "config", `hook.${name}.event`, event);
    git(dir, "config", `hook.${name}.command`, "true");
    return git(dir, "hook", "list", event).includes(name);
  } catch {
    return false;
  }
}

describe("hook.* handling", { timeout: 30_000 }, () => {
  it("hookNames parses hook.* keys and the protected envs disable each one", async () => {
    expect(
      hookNames(
        "hook.x.command\nhook.x.event\nhook.y.enabled\nhook.my hook.command\nhook.Up.Case.event\ncore.bare\n",
      ),
    ).toEqual(["x", "y", "my hook", "Up.Case"]);
    const fx = makeFixture();
    git(fx.repoDir, "config", "hook.x.command", "true");
    git(fx.repoDir, "config", "hook.y.enabled", "true");
    const pairs = pairsOfEnv(await protectedEnv(fx.repoDir));
    expect(pairs).toEqual(
      expect.arrayContaining([
        "hook.x.enabled=false",
        "hook.y.enabled=false",
        "core.hooksPath=/dev/null",
        "core.fsmonitor=false",
      ]),
    );
    const step = stepEnv(
      { baseEnv: baseEnv(), worktree: fx.repoDir },
      fx.repoDir,
      fx.root,
      [],
      ["x"],
    );
    expect(pairsOfEnv(step)).toContain("hook.x.enabled=false");
  });

  it("commitWorktree runs no config-defined post-commit hook", async (ctx) => {
    if (!supportsConfigHooks("post-commit", "probe")) ctx.skip();
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
    const before = git(worktree, "rev-parse", "HEAD");
    writeFileSync(join(worktree, "novo.txt"), "novo\n");
    const out = await commitWorktree({
      git: "git",
      worktree,
      message: "novo",
      baseEnv: baseEnv(),
    });
    expect(out.sha).not.toBe(before);
    expect(existsSync(marker)).toBe(false);
    // Positive check: the same hook does run on a plain commit.
    git(fx.repoDir, "config", "hook.mark.command", `touch "${posix(positive)}"; :`);
    writeFileSync(join(worktree, "outro.txt"), "outro\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "plain");
    expect(existsSync(positive)).toBe(true);
  });
});
