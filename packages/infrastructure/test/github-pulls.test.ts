import { describe, expect, it } from "vitest";
import { PrDiffTruncatedError } from "@friday/application";
import { GitHubRestAdapter } from "../src/github-rest-adapter.ts";
import { createGitHubFake, createTestOctokit } from "./github-fake.ts";

function setup() {
  const fake = createGitHubFake();
  const adapter = new GitHubRestAdapter(createTestOctokit(fake.fetch), { owner: "o", repo: "r" });
  return { fake, adapter };
}
const input = { head: "friday/18-x", base: "develop", title: "t", body: "b" };
const pr = (sha: string) => ({
  number: 30,
  head: "o:friday/18-x",
  headRef: "friday/18-x",
  base: "develop",
  sha,
});

describe("GitHubRestAdapter pull requests", () => {
  it("createPullRequest reuses an open pull request", async () => {
    const { fake, adapter } = setup();
    expect(await adapter.createPullRequest(input)).toEqual({
      number: 30,
      headSha: "aaa",
      created: true,
    });
    expect(fake.calls[0]).toMatchObject({
      method: "GET",
      path: "/repos/o/r/pulls",
      query: { head: "o:friday/18-x", base: "develop", state: "open" },
    });
    const post = fake.calls.filter((c) => c.method === "POST");
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({ path: "/repos/o/r/pulls", body: input });
    expect(await adapter.createPullRequest(input)).toEqual({
      number: 30,
      headSha: "aaa",
      created: false,
    });
    expect(fake.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("getCiStatus maps check runs by name", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [pr("abc")];
    const state = async (
      runs: { id: number; name: string; status: string; conclusion: string | null }[],
    ) => {
      fake.checkRuns.set("abc", runs);
      return adapter.getCiStatus(30, "check");
    };
    const done = (id: number, conclusion: string) => ({
      id,
      name: "check",
      status: "completed",
      conclusion,
    });
    expect(await state([done(1, "success")])).toEqual({ headSha: "abc", state: "success" });
    expect((await state([done(1, "failure")])).state).toBe("failure");
    expect(
      (await state([{ id: 1, name: "check", status: "in_progress", conclusion: null }])).state,
    ).toBe("pending");
    expect(
      (await state([{ id: 1, name: "lint", status: "completed", conclusion: "success" }])).state,
    ).toBe("missing");
    expect((await state([done(1, "failure"), done(2, "success")])).state).toBe("success");
    fake.pageSize = 1;
    expect((await state([done(2, "success"), done(1, "failure")])).state).toBe("success");
  });

  it("getPrDiff maps files and counts patch bytes", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [pr("abc")];
    fake.pageSize = 1;
    fake.files.set(30, [
      { filename: "a.ts", additions: 3, deletions: 2, patch: "ção" },
      { filename: "img.png", additions: 0, deletions: 0 },
    ]);
    expect(await adapter.getPrDiff(30)).toEqual({
      files: [
        { path: "a.ts", changedLines: 5, hasPatch: true },
        { path: "img.png", changedLines: 0, hasPatch: false },
      ],
      diffBytes: 5,
    });
    fake.files.set(30, []);
    expect(await adapter.getPrDiff(30)).toEqual({ files: [], diffBytes: 0 });
  });

  it("getPrDiff also lists the origin path of a renamed file", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [{ ...pr("abc"), number: 31 }];
    fake.files.set(31, [
      {
        filename: "docs/ci.yml",
        previous_filename: ".github/workflows/ci.yml",
        additions: 0,
        deletions: 0,
        patch: "x",
      },
    ]);
    expect(await adapter.getPrDiff(31)).toEqual({
      files: [
        { path: "docs/ci.yml", changedLines: 0, hasPatch: true },
        { path: ".github/workflows/ci.yml", changedLines: 0, hasPatch: true },
      ],
      diffBytes: 1,
    });
  });

  const f = (filename: string) => ({ filename, additions: 1, deletions: 0, patch: "x" });

  it("getPrDiff resolves when the received count equals changed_files across pages", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [{ ...pr("abc"), changedFiles: 3 }];
    fake.pageSize = 1;
    fake.files.set(30, [f("a.ts"), f("b.ts"), f("c.ts")]);
    const diff = await adapter.getPrDiff(30);
    expect(diff.files.map((x) => x.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("getPrDiff rejects with diff_truncated when fewer files than changed_files arrive", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [{ ...pr("abc"), changedFiles: 4 }];
    fake.files.set(30, [f("a.ts"), f("b.ts"), f("c.ts")]);
    const err = await adapter.getPrDiff(30).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrDiffTruncatedError);
    expect(err).toMatchObject({ code: "diff_truncated", expected: 4, received: 3 });
  });

  it("getPrDiff rejects when more files than changed_files arrive", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [{ ...pr("abc"), changedFiles: 3 }];
    fake.files.set(30, [f("a.ts"), f("b.ts"), f("c.ts"), f("d.ts")]);
    const err = await adapter.getPrDiff(30).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrDiffTruncatedError);
    expect(err).toMatchObject({ expected: 3, received: 4 });
  });

  it("getPrDiff counts a renamed file once against changed_files", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [{ ...pr("abc"), changedFiles: 1 }];
    fake.files.set(30, [{ ...f("docs/ci.yml"), previous_filename: ".github/workflows/ci.yml" }]);
    expect((await adapter.getPrDiff(30)).files).toHaveLength(2);
  });

  it("getPrDiff accepts an empty pull request with changed_files 0", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [{ ...pr("abc"), changedFiles: 0 }];
    expect(await adapter.getPrDiff(30)).toEqual({ files: [], diffBytes: 0 });
  });

  it("PrDiffTruncatedError is exported and carries code and counts", () => {
    const e = new PrDiffTruncatedError(4, 3);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: "diff_truncated", expected: 4, received: 3 });
    expect(e.name).toBe("PrDiffTruncatedError");
    expect(e.message).toBe("Diff do PR incompleto: esperados 4 arquivos, recebidos 3.");
  });

  it("squashMerge refuses a different head sha", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [pr("abc")];
    const puts = () => fake.calls.filter((c) => c.method === "PUT");
    expect(await adapter.squashMerge(30, "abc")).toEqual({ merged: true, sha: "m1" });
    expect(puts()).toHaveLength(1);
    expect(puts()[0]).toMatchObject({
      path: "/repos/o/r/pulls/30/merge",
      body: { merge_method: "squash", sha: "abc" },
    });
    expect(await adapter.squashMerge(30, "zzz")).toEqual({ merged: false, reason: "head_changed" });
    expect(puts()).toHaveLength(1);
    fake.mergeStatus = 409;
    expect(await adapter.squashMerge(30, "abc")).toEqual({ merged: false, reason: "head_changed" });
    fake.mergeStatus = 405;
    expect(await adapter.squashMerge(30, "abc")).toEqual({
      merged: false,
      reason: "not_mergeable",
    });
    fake.mergeStatus = 500;
    await expect(adapter.squashMerge(30, "abc")).rejects.toThrow();
    const before = puts().length;
    await expect(adapter.squashMerge(99, "abc")).rejects.toThrow();
    expect(puts()).toHaveLength(before);
  });
});
