import { describe, expect, it } from "vitest";
import { FakeGitHubPort } from "@friday/application";
import { GitHubRestAdapter } from "../src/github-rest-adapter.ts";
import { createGitHubFake, createTestOctokit } from "./github-fake.ts";

function setup() {
  const fake = createGitHubFake();
  const adapter = new GitHubRestAdapter(createTestOctokit(fake.fetch), { owner: "o", repo: "r" });
  return { fake, adapter };
}
const pr = (sha: string, merged?: boolean) => ({
  number: 30,
  head: "o:friday/18-x",
  headRef: "friday/18-x",
  base: "develop",
  sha,
  ...(merged === undefined ? {} : { merged }),
});

describe("GitHubRestAdapter getPrMergeState", () => {
  it("returns merged true with the head sha", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [pr("abc", true)];
    expect(await adapter.getPrMergeState(30)).toEqual({ merged: true, headSha: "abc" });
  });

  it("returns merged false for an open pull request", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [pr("def")];
    expect(await adapter.getPrMergeState(30)).toEqual({ merged: false, headSha: "def" });
  });

  it("issues a single GET to the pull route", async () => {
    const { fake, adapter } = setup();
    fake.pulls = [pr("abc")];
    await adapter.getPrMergeState(30);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: "GET", path: "/repos/o/r/pulls/30" });
    expect(fake.calls[0]?.path).not.toContain("graphql");
  });

  it("rejects with 404 for an unknown pull request", async () => {
    const { adapter } = setup();
    await expect(adapter.getPrMergeState(99)).rejects.toMatchObject({ status: 404 });
  });
});

describe("FakeGitHubPort getPrMergeState", () => {
  it("fake returns the default state and records the call", async () => {
    const port = new FakeGitHubPort();
    expect(await port.getPrMergeState(30)).toEqual({ merged: false, headSha: "a".repeat(40) });
    expect(port.calls).toContainEqual({ method: "getPrMergeState", args: [30] });
  });

  it("fake honours prMergeState and fail options", async () => {
    const state = { merged: true, headSha: "b".repeat(40) };
    expect(await new FakeGitHubPort({ prMergeState: state }).getPrMergeState(30)).toEqual(state);
    await expect(new FakeGitHubPort({ fail: new Error("x") }).getPrMergeState(30)).rejects.toThrow(
      "x",
    );
  });
});
