import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { makeFixture, type Fixture } from "./worktree-helpers.ts";

let fx: Fixture;
const fail = (code: string) => Object.assign(new Error(code), { code });
const rm = () => ({ root: fx.root, project: fx.project, issue: 15 });
const setup = async (removeDir: (p: string) => Promise<void>) => {
  const sleep = vi.fn(async () => {});
  const m = new GitWorktreeManager({ repoDir: fx.repoDir, removeDir, sleep });
  await m.create({ ...rm(), title: "t", base: "develop" });
  return m;
};

beforeEach(() => {
  fx = makeFixture();
});

describe("locked directory", () => {
  it("remove retries a locked directory until it succeeds", async () => {
    for (const code of ["EBUSY", "EPERM", "ENOTEMPTY"]) {
      fx = makeFixture();
      let calls = 0;
      const m = await setup(async () => {
        if (++calls < 3) throw fail(code);
      });
      expect(await m.remove(rm())).toEqual({ ok: true, value: undefined });
      expect(calls).toBe(3);
    }
  }, 30_000);

  it("remove fails with WorktreeRemoveFailed after exhausting retries", async () => {
    const always = vi.fn(async () => {
      throw fail("EBUSY");
    });
    const m = await setup(always);
    const r = await m.remove(rm());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("WorktreeRemoveFailed");
      expect(r.error.message).toMatch(/worktree|diretório/i);
    }
    expect(always).toHaveBeenCalledTimes(3);
  }, 30_000);

  it("remove treats ENOENT as already removed", async () => {
    const enoent = vi.fn(async () => {
      throw fail("ENOENT");
    });
    const m = await setup(enoent);
    expect((await m.remove(rm())).ok).toBe(true);
    expect(enoent).toHaveBeenCalledTimes(1);
  }, 30_000);
});
