import { describe, expect, it } from "vitest";
import { GitHubRestAdapter } from "../src/github-rest-adapter.ts";
import { createGitHubFake, createTestOctokit } from "./github-fake.ts";

function setup() {
  const fake = createGitHubFake();
  const adapter = new GitHubRestAdapter(createTestOctokit(fake.fetch), { owner: "o", repo: "r" });
  fake.pulls = [
    { number: 30, head: "o:friday/18-x", headRef: "friday/18-x", base: "develop", sha: "abc" },
  ];
  return { fake, adapter };
}

const PAT = "Resource not accessible by personal access token";
const DOC = "https://docs.github.com/rest/checks/runs#list-check-runs-for-a-git-reference";

async function failure(
  p: Promise<unknown>,
): Promise<Error & { cause?: { status?: number }; status?: number }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { cause?: { status?: number }; status?: number };
  }
  throw new Error("expected rejection");
}

function expectExplained(error: Error & { cause?: { status?: number } }) {
  for (const word of ["fine-grained", "GitHub App", "token clássico", "repo"]) {
    expect(error.message).toContain(word);
  }
  expect(error.message).not.toContain("Resource not accessible");
  expect(error.cause?.status).toBe(403);
}

describe("GitHubRestAdapter getCiStatus errors", () => {
  it("getCiStatus explains the fine-grained token 403 in pt-BR", async () => {
    const { fake, adapter } = setup();
    fake.checkRunsError = { status: 403, message: PAT };
    expectExplained(await failure(adapter.getCiStatus(30, "check")));
  });

  it("getCiStatus recognizes the 403 when the body has documentation_url", async () => {
    const { fake, adapter } = setup();
    fake.checkRunsError = { status: 403, message: PAT, documentation_url: DOC };
    expectExplained(await failure(adapter.getCiStatus(30, "check")));
  });

  it("getCiStatus keeps other 403, 404 and 500 errors untouched", async () => {
    const { fake, adapter } = setup();
    fake.checkRunsError = { status: 403, message: "Resource not accessible by integration" };
    const a = await failure(adapter.getCiStatus(30, "check"));
    expect(a.message).toContain("Resource not accessible by integration");
    expect(a.message).not.toContain("fine-grained");
    fake.checkRunsError = { status: 404, message: "Not Found" };
    const b = await failure(adapter.getCiStatus(30, "check"));
    expect(b.status).toBe(404);
    expect(b.message).not.toContain("fine-grained");
    fake.checkRunsError = { status: 500, message: PAT };
    const c = await failure(adapter.getCiStatus(30, "check"));
    expect(c.message).not.toContain("fine-grained");
  });
});
