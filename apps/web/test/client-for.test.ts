import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultClientFor } from "../src/client-for.ts";

afterEach(() => vi.unstubAllGlobals());

describe("defaultClientFor", () => {
  it("sends each host its own token", async () => {
    const data: Record<string, string> = {
      "friday.panelToken.h1": "t1",
      "friday.panelToken.h2": "t2",
    };
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => data[k] ?? null });
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchFn);
    await defaultClientFor({ name: "h1", baseUrl: "" }).fetchHealth();
    await defaultClientFor({ name: "h2", baseUrl: "" }).fetchHealth();
    expect(fetchFn.mock.calls[0]?.[1]).toEqual({ headers: { "x-friday-token": "t1" } });
    expect(fetchFn.mock.calls[1]?.[1]).toEqual({ headers: { "x-friday-token": "t2" } });
  });
});
