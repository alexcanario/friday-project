import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";

afterEach(() => vi.unstubAllGlobals());

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
const review = {
  judge: { outcome: "approve", reviewId: 1, feedback: null, at: "2026-11-19T10:00:00Z" },
  pr: { number: 7 },
};

function stub(body: unknown, status = 200) {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("run detail api", () => {
  it("fetchRun and fetchRunReview call the run routes, validate the body and reject 404", async () => {
    let fn = stub(run);
    await expect(createApiClient("").fetchRun("o/r", "r1")).resolves.toEqual(run);
    expect(fn).toHaveBeenCalledWith("/runs/r1?project=o%2Fr", { redirect: "manual" });
    await createApiClient("").fetchRun("o/r", "a/b");
    expect(fn).toHaveBeenLastCalledWith("/runs/a%2Fb?project=o%2Fr", { redirect: "manual" });

    fn = stub(review);
    await expect(createApiClient("").fetchRunReview("o/r", "r1")).resolves.toEqual(review);
    expect(fn).toHaveBeenCalledWith("/runs/r1/review?project=o%2Fr", { redirect: "manual" });

    fn = stub(run);
    await createApiClient("", () => "tok").fetchRun("o/r", "r1");
    expect(fn).toHaveBeenCalledWith("/runs/r1?project=o%2Fr", {
      headers: { "x-friday-token": "tok" },
      redirect: "manual",
    });

    stub({}, 404);
    await expect(createApiClient("").fetchRun("o/r", "r1")).rejects.toMatchObject({
      name: "ApiHttpError",
      status: 404,
    });
    await expect(createApiClient("").fetchRunReview("o/r", "r1")).rejects.toMatchObject({
      status: 404,
    });

    stub({ ...run, costUsd: "0.5" });
    await expect(createApiClient("").fetchRun("o/r", "r1")).rejects.toThrow();
    stub({ ...review, pr: { number: "7" } });
    await expect(createApiClient("").fetchRunReview("o/r", "r1")).rejects.toThrow();
  });
});
