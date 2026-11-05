import { describe, expect, it } from "vitest";
import { GitHubRestAdapter } from "../src/github-rest-adapter.ts";
import { createGitHubFake, createTestOctokit } from "./github-fake.ts";

function setup() {
  const fake = createGitHubFake();
  const adapter = new GitHubRestAdapter(createTestOctokit(fake.fetch), { owner: "o", repo: "r" });
  return { fake, adapter };
}
const posts = (calls: { method: string }[]) => calls.filter((c) => c.method === "POST");

describe("GitHubRestAdapter issues", () => {
  it("lists open issues by label across pages without pull requests", async () => {
    const { fake, adapter } = setup();
    fake.pageSize = 3;
    fake.issues = [
      { number: 5, labels: ["friday"], body: null },
      { number: 6, labels: ["friday"], body: "b" },
      { number: 8, labels: ["friday"], pullRequest: true },
      { number: 7, labels: ["friday", "x"] },
    ];
    const issues = await adapter.listIssuesByLabel("friday");
    expect(issues.map((i) => i.number)).toEqual([5, 6, 7]);
    expect(issues[0]?.body).toBe("");
    expect(issues[2]?.labels).toEqual(["friday", "x"]);
    expect(fake.calls[0]).toMatchObject({
      method: "GET",
      path: "/repos/o/r/issues",
      query: { labels: "friday", state: "open", per_page: "100" },
    });
    expect(fake.calls.length).toBe(2);
    fake.issues = [];
    expect(await adapter.listIssuesByLabel("friday")).toEqual([]);
  });

  it("addLabel is idempotent", async () => {
    const { fake, adapter } = setup();
    fake.issues = [{ number: 5, labels: ["status:ready"] }];
    await adapter.addLabel(5, "status:ready");
    expect(posts(fake.calls)).toEqual([]);
    await adapter.addLabel(5, "gate:security");
    expect(posts(fake.calls)).toHaveLength(1);
    expect(posts(fake.calls)[0]).toMatchObject({
      path: "/repos/o/r/issues/5/labels",
      body: { labels: ["gate:security"] },
    });
    await adapter.addLabel(5, "gate:security");
    expect(posts(fake.calls)).toHaveLength(1);
  });

  it("removeLabel only deletes an existing label", async () => {
    const { fake, adapter } = setup();
    fake.issues = [{ number: 5, labels: ["status:ready", "gate:security"] }];
    const deletes = () => fake.calls.filter((c) => c.method === "DELETE");
    await adapter.removeLabel(5, "status:ready");
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]?.path).toBe("/repos/o/r/issues/5/labels/status:ready");
    await adapter.removeLabel(5, "status:ready");
    await adapter.removeLabel(5, "gate:business");
    expect(deletes()).toHaveLength(1);
  });

  it("agent comments carry the role prefix and are not duplicated", async () => {
    const { fake, adapter } = setup();
    fake.issues = [{ number: 5 }];
    expect(await adapter.postAgentComment(5, "qa", "Aprovado")).toEqual({ created: true });
    expect(posts(fake.calls)).toHaveLength(1);
    expect(posts(fake.calls)[0]).toMatchObject({
      path: "/repos/o/r/issues/5/comments",
      body: { body: "agent:qa: Aprovado" },
    });
    expect(await adapter.postAgentComment(5, "qa", "Aprovado")).toEqual({ created: false });
    expect(posts(fake.calls)).toHaveLength(1);
    expect(await adapter.postAgentComment(5, "qa", "Reprovado")).toEqual({ created: true });
    expect(posts(fake.calls)).toHaveLength(2);
    const before = fake.calls.length;
    await expect(adapter.postAgentComment(5, "QA Bot", "x")).rejects.toThrow("papel inválido");
    await expect(adapter.postAgentComment(5, "", "x")).rejects.toThrow("papel inválido");
    expect(fake.calls.length).toBe(before);
  });
});
