import { describe, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() =>
  vi.fn((_f: string, _a: string[], _o: object, cb: (e: Error | null, out: string) => void) =>
    cb(null, "[]"),
  ),
);
vi.mock("node:child_process", () => ({ execFile }));

import { createGhNightReader } from "../src/gh-night-reader.ts";

const R = "repos/alexcanario/friday-project";

describe("createGhNightReader", () => {
  it("calls gh api REST only, maps fields and drops pull requests", async () => {
    const calls: string[][] = [];
    const answers: string[] = [
      JSON.stringify([{ body: "oi", created_at: "t1" }]),
      JSON.stringify([
        { number: 1, title: "a", labels: [{ name: "x" }] },
        { number: 2, title: "pr", labels: [], pull_request: {} },
      ]),
      JSON.stringify([
        { number: 5, title: "p", body: null, merged_at: "t2", base: { ref: "develop" } },
      ]),
      "[]",
    ];
    const exec = vi.fn(async (args: string[]) => {
      calls.push(args);
      return answers.shift() ?? "[]";
    });
    const reader = createGhNightReader({ exec });
    expect(await reader.listComments(1)).toEqual([{ body: "oi", createdAt: "t1" }]);
    expect(await reader.listOpenIssues("status:ready")).toEqual([
      { number: 1, title: "a", labels: ["x"] },
    ]);
    expect(await reader.listClosedPulls()).toEqual([
      { number: 5, title: "p", body: "", mergedAt: "t2", baseRef: "develop" },
    ]);
    await reader.listOpenPulls();
    expect(calls).toEqual([
      ["api", `${R}/issues/1/comments?per_page=100&page=1`],
      ["api", "--paginate", `${R}/issues?state=open&per_page=100&labels=status:ready`],
      ["api", `${R}/pulls?state=closed&sort=updated&direction=desc&per_page=100`],
      ["api", "--paginate", `${R}/pulls?state=open&per_page=100`],
    ]);
    expect(calls.flat()).not.toContain("graphql");
    const boom = createGhNightReader({ exec: async () => Promise.reject(new Error("boom")) });
    await expect(boom.listOpenPulls()).rejects.toThrow("boom");
  });

  it("default exec passes a maxBuffer of at least 64 MiB to execFile", async () => {
    await createGhNightReader().listOpenPulls();
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, opts] = execFile.mock.calls[0] as unknown as [
      string,
      string[],
      { maxBuffer: number },
    ];
    expect(file).toBe("gh");
    expect(args).toEqual(["api", "--paginate", `${R}/pulls?state=open&per_page=100`]);
    expect(opts.maxBuffer).toBeGreaterThanOrEqual(67108864);
  });
});

describe("listComments pagination", () => {
  const items = (n: number) =>
    JSON.stringify(Array.from({ length: n }, (_, i) => ({ body: `b${i}`, created_at: `t${i}` })));
  const page = (args: string[]) => args[1]?.match(/page=(\d+)/)?.[1];

  it("listComments makes one page=1 call without --paginate for an empty result", async () => {
    const exec = vi.fn(async (_a: string[]) => "[]");
    expect(await createGhNightReader({ exec }).listComments(1)).toEqual([]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(["api", `${R}/issues/1/comments?per_page=100&page=1`]);
    expect(exec.mock.calls.flat().flat()).not.toContain("--paginate");
  });

  it("listComments reads page 2 when page 1 has 100 items and stops after a short page", async () => {
    const exec = vi.fn(async (a: string[]) => (page(a) === "1" ? items(100) : items(1)));
    const out = await createGhNightReader({ exec }).listComments(1);
    expect(exec.mock.calls.map((c) => page(c[0]))).toEqual(["1", "2"]);
    expect(out).toHaveLength(101);
    expect(out[0]).toEqual({ body: "b0", createdAt: "t0" });
    expect(out[100]).toEqual({ body: "b0", createdAt: "t0" });
    expect(out[99]).toEqual({ body: "b99", createdAt: "t99" });
  });

  it("listComments does not request a second page when page 1 has fewer than 100 items", async () => {
    const exec = vi.fn(async (_a: string[]) => items(99));
    expect(await createGhNightReader({ exec }).listComments(1)).toHaveLength(99);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("listComments propagates an exec failure", async () => {
    const exec = async () => Promise.reject(new Error("boom"));
    await expect(createGhNightReader({ exec }).listComments(1)).rejects.toThrow("boom");
  });
});
