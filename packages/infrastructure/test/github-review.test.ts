import { Octokit } from "octokit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubRestAdapter } from "../src/github-rest-adapter.ts";
import { createGitHubClient } from "../src/github-client.ts";
import { createGitHubFake, createTestOctokit } from "./github-fake.ts";

afterEach(() => vi.unstubAllGlobals());

const repo = { owner: "o", repo: "r" };

describe("GitHubRestAdapter reviews", () => {
  it("postReview posts commit_id, body and event for each event", async () => {
    for (const event of ["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const) {
      const fake = createGitHubFake();
      const adapter = new GitHubRestAdapter(createTestOctokit(fake.fetch), repo);
      const res = await adapter.postReview(30, { commitId: "abc123", body: "texto", event });
      expect(res).toEqual({ id: 501 });
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]).toMatchObject({
        method: "POST",
        path: "/repos/o/r/pulls/30/reviews",
        body: { commit_id: "abc123", body: "texto", event },
      });
      expect(fake.calls[0]?.body).toEqual({ commit_id: "abc123", body: "texto", event });
    }
  });

  it("postReview rejects when the API answers 422", async () => {
    const fake = createGitHubFake();
    fake.reviewStatus = 422;
    const adapter = new GitHubRestAdapter(createTestOctokit(fake.fetch), repo);
    await expect(
      adapter.postReview(30, { commitId: "abc123", body: "texto", event: "APPROVE" }),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(1);
  });
});

function stubFetch(status: number, body: unknown, seen: Headers[] = []) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers ?? (input instanceof Request ? input.headers : {})));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return seen;
}

describe("createGitHubClient", () => {
  it("createGitHubClient builds an Octokit that sends the token and refuses a blank one", async () => {
    const client = createGitHubClient("ghs_marker_token");
    expect(client).toBeInstanceOf(Octokit);
    const seen = stubFetch(200, { id: 501 });
    const res = await new GitHubRestAdapter(client, repo).postReview(30, {
      commitId: "abc123",
      body: "texto",
      event: "COMMENT",
    });
    expect(res).toEqual({ id: 501 });
    expect(seen[0]?.get("authorization")).toContain("ghs_marker_token");
    for (const blank of ["", "   "]) {
      expect(() => createGitHubClient(blank)).toThrow(new Error("token de revisão vazio"));
    }
  });

  it("a 422 error never leaks the token", async () => {
    stubFetch(422, { message: "Validation Failed" });
    const adapter = new GitHubRestAdapter(createGitHubClient("ghs_marker_token"), repo);
    const error = await adapter
      .postReview(30, { commitId: "abc123", body: "texto", event: "APPROVE" })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(error).not.toBeNull();
    expect(error?.message).not.toContain("ghs_marker_token");
    expect(JSON.stringify(error)).not.toContain("ghs_marker_token");
  });
});
