import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";

afterEach(() => vi.unstubAllGlobals());

const runs = [
  {
    id: "r1",
    issueId: 1,
    phase: null,
    status: "running",
    startedAt: null,
    finishedAt: null,
    costUsd: null,
    numTurns: null,
  },
  {
    id: "r2",
    issueId: 2,
    phase: null,
    status: "succeeded",
    startedAt: null,
    finishedAt: "2026-11-19T01:00:00.000Z",
    costUsd: 0.5,
    numTurns: 3,
  },
];
const status = (enabled: boolean | null) => ({
  enabled,
  breaker: { open: false, openedAt: null, failures: [] },
});
const day = { costUsd: 1.5, anyCostUnknown: true };

function stub(
  enabled: boolean | null,
  override?: { match: string; status: number; body?: unknown },
) {
  const fn = vi.fn((url: string) => {
    let body: unknown = day;
    if (url.includes("/status")) body = status(enabled);
    else if (url.includes("/runs")) body = runs;
    if (override && url.includes(override.match)) {
      return Promise.resolve(
        new Response(JSON.stringify(override.body ?? body), { status: override.status }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("project overview", () => {
  it("fetchProjectOverview combines status, runs and day sum and rejects bad responses", async () => {
    const client = createApiClient("", () => "t");
    const fn = stub(true);
    await expect(client.fetchProjectOverview("a/b", "2026-11-19")).resolves.toEqual({
      enabled: true,
      breakerOpen: false,
      activeRuns: 1,
      dayCostUsd: 1.5,
      anyCostUnknown: true,
    });
    expect(new Set(fn.mock.calls.map((c) => c[0]))).toEqual(
      new Set([
        "/status?project=a%2Fb",
        "/runs?project=a%2Fb",
        "/ledger/days/2026-11-19?project=a%2Fb",
      ]),
    );
    for (const call of fn.mock.calls) {
      expect(call[1]).toEqual({ headers: { "x-friday-token": "t" } });
    }
    stub(null);
    await expect(client.fetchProjectOverview("a/b", "2026-11-19")).resolves.toMatchObject({
      enabled: null,
    });
    for (const match of ["/status", "/runs", "/ledger"]) {
      stub(true, { match, status: 500 });
      await expect(client.fetchProjectOverview("a/b", "2026-11-19")).rejects.toThrow();
      stub(true, { match, status: 200, body: { bad: true } });
      await expect(client.fetchProjectOverview("a/b", "2026-11-19")).rejects.toThrow();
    }
  });
});
