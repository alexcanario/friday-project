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
      ["api", "--paginate", `${R}/issues/1/comments?per_page=100`],
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
