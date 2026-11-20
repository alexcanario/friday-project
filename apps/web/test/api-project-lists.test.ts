import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiHttpError } from "../src/api-errors.ts";
import { createApiClient } from "../src/api.ts";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function stub(body: unknown, status = 200) {
  const fn = vi.fn(() => json(body, status));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const run = {
  id: "r1",
  issueId: 14,
  phase: "implement",
  status: "running",
  startedAt: null,
  finishedAt: null,
  costUsd: 0.5,
  numTurns: 3,
};

describe("api client project lists", () => {
  it("fetches issues and runs by project, with token when present, and rejects HTTP 500 and invalid payloads", async () => {
    const issues = [{ issueId: 14, state: "Todo", heldReason: null }];
    let fn = stub(issues);
    await expect(createApiClient("").fetchIssues("p1")).resolves.toEqual(issues);
    expect(fn.mock.calls[0]).toEqual(["/issues?project=p1", { redirect: "manual" }]);

    fn = stub([run]);
    await expect(createApiClient("https://h:1/", () => "s3cret").fetchRuns("p 1")).resolves.toEqual([
      run,
    ]);
    expect(fn).toHaveBeenCalledWith("https://h:1/runs?project=p%201", {
      headers: { "x-friday-token": "s3cret" },
      redirect: "manual",
    });

    const client = createApiClient("");
    stub([], 500);
    await expect(client.fetchIssues("p1")).rejects.toBeInstanceOf(ApiHttpError);
    await expect(client.fetchIssues("p1")).rejects.toMatchObject({ status: 500 });
    await expect(client.fetchRuns("p1")).rejects.toMatchObject({ status: 500 });
    stub([{ issueId: "14" }]);
    await expect(client.fetchIssues("p1")).rejects.toThrow();
    stub([{ id: 1 }]);
    await expect(client.fetchRuns("p1")).rejects.toThrow();
  });
});
