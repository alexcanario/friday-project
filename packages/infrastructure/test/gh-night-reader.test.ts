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
      ["api", `${R}/issues?state=open&per_page=100&labels=status:ready&page=1`],
      ["api", `${R}/pulls?state=closed&sort=updated&direction=desc&per_page=100`],
      ["api", `${R}/pulls?state=open&per_page=100&page=1`],
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
    expect(args).toEqual(["api", `${R}/pulls?state=open&per_page=100&page=1`]);
    expect(opts.maxBuffer).toBeGreaterThanOrEqual(67108864);
  });
});

describe("listComments pagination", () => {
  const items = (n: number) =>
    JSON.stringify(Array.from({ length: n }, (_, i) => ({ body: `b${i}`, created_at: `t${i}` })));
  const page = (args: string[]) => args[1]?.match(/&page=(\d+)/)?.[1];

  it("listComments makes one page=1 call without --paginate for an empty result", async () => {
    const exec = vi.fn(async () => "[]");
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
    const exec = vi.fn(async () => items(99));
    expect(await createGhNightReader({ exec }).listComments(1)).toHaveLength(99);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("listComments propagates an exec failure", async () => {
    const exec = async () => Promise.reject(new Error("boom"));
    await expect(createGhNightReader({ exec }).listComments(1)).rejects.toThrow("boom");
  });
});

describe("open issues and pulls pagination", () => {
  const issues = (n: number, prAt?: number) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        number: i + 1,
        title: `t${i}`,
        labels: [{ name: "l" }],
        ...(i === prAt ? { pull_request: {} } : {}),
      })),
    );
  const pulls = (n: number) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        number: i + 1,
        title: `p${i}`,
        body: null,
        merged_at: null,
        base: { ref: "develop" },
      })),
    );
  const page = (args: string[]) => args[1]?.match(/&page=(\d+)/)?.[1];

  it("listOpenIssues makes one page=1 call without --paginate for an empty result", async () => {
    const exec = vi.fn(async () => "[]");
    expect(await createGhNightReader({ exec }).listOpenIssues("status:ready")).toEqual([]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith([
      "api",
      `${R}/issues?state=open&per_page=100&labels=status:ready&page=1`,
    ]);
  });

  it("listOpenIssues reads page 2 when page 1 has 100 items", async () => {
    const exec = vi.fn(async (a: string[]) => (page(a) === "1" ? issues(100) : issues(1)));
    const out = await createGhNightReader({ exec }).listOpenIssues("x");
    expect(exec.mock.calls.map((c) => page(c[0]))).toEqual(["1", "2"]);
    expect(out).toHaveLength(101);
    expect(out[99]?.number).toBe(100);
    expect(out[100]?.number).toBe(1);
  });

  it("listOpenIssues does not request a second page when page 1 has fewer than 100 items", async () => {
    const exec = vi.fn(async () => issues(99));
    expect(await createGhNightReader({ exec }).listOpenIssues("x")).toHaveLength(99);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("listOpenIssues drops pull requests on every page", async () => {
    const exec = vi.fn(async (a: string[]) => (page(a) === "1" ? issues(100, 0) : issues(2, 1)));
    const out = await createGhNightReader({ exec }).listOpenIssues("x");
    expect(exec.mock.calls.map((c) => page(c[0]))).toEqual(["1", "2"]);
    expect(out).toHaveLength(100);
    expect(out[99]).toEqual({ number: 1, title: "t0", labels: ["l"] });
  });

  it("listOpenPulls makes one page=1 call without --paginate for an empty result", async () => {
    const exec = vi.fn(async () => "[]");
    expect(await createGhNightReader({ exec }).listOpenPulls()).toEqual([]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(["api", `${R}/pulls?state=open&per_page=100&page=1`]);
  });

  it("listOpenPulls paginates manually and stops after a short page", async () => {
    const exec = vi.fn(async (a: string[]) => (page(a) === "1" ? pulls(100) : pulls(1)));
    const out = await createGhNightReader({ exec }).listOpenPulls();
    expect(exec.mock.calls.map((c) => page(c[0]))).toEqual(["1", "2"]);
    expect(out).toHaveLength(101);
    const short = vi.fn(async () => pulls(99));
    expect(await createGhNightReader({ exec: short }).listOpenPulls()).toHaveLength(99);
    expect(short).toHaveBeenCalledTimes(1);
  });

  it("listOpenIssues and listOpenPulls propagate an exec failure on page 2", async () => {
    const failing = (full: string) => async (a: string[]) => {
      if (page(a) === "1") return full;
      throw new Error("boom");
    };
    const i = createGhNightReader({ exec: failing(issues(100)) });
    await expect(i.listOpenIssues("x")).rejects.toThrow("boom");
    const p = createGhNightReader({ exec: failing(pulls(100)) });
    await expect(p.listOpenPulls()).rejects.toThrow("boom");
  });
});
