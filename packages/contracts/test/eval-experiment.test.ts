import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  experimentIssuesSchema,
  experimentRunsSchema,
  experimentVariantsSchema,
} from "../src/index.ts";

const registry = resolve(import.meta.dirname, "../../../registry");
const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(resolve(registry, file), "utf8"));

const run = {
  itemId: "E1",
  kind: "backend",
  variant: "generic",
  status: "done",
  costUsd: 1,
  rounds: 1,
  judgeFirstRound: true,
  durationS: 100,
  peakContextTokens: 10000,
};

describe("experiment schemas", () => {
  it("accepts valid experiment runs and rejects invalid ones", () => {
    expect(experimentRunsSchema.safeParse([run, { ...run, peakContextTokens: null }]).success).toBe(
      true,
    );
    const bad: Record<string, unknown>[] = [
      { ...run, kind: "devops" },
      { ...run, judgeFirstRound: undefined },
      { ...run, durationS: -1 },
      { ...run, variant: "Generic" },
      { ...run, costUsd: "1" },
      { ...run, peakContextTokens: -1 },
      { ...run, peakContextTokens: 1.5 },
    ];
    for (const item of bad) expect(experimentRunsSchema.safeParse([item]).success).toBe(false);
    const withoutPeak: Record<string, unknown> = { ...run };
    delete withoutPeak.peakContextTokens;
    expect(experimentRunsSchema.safeParse([withoutPeak]).success).toBe(false);
  });

  it("variants file is valid and invalid variant lists are rejected", () => {
    const raw = readJson("eval/variants.json");
    expect(experimentVariantsSchema.safeParse(raw).success).toBe(true);
    const ids = (raw as { id: string }[]).map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["generic", "generic-context", "specialists"]));
    expect(experimentVariantsSchema.safeParse([]).success).toBe(false);
    const v = { id: "generic", title: "t", description: "d" };
    expect(experimentVariantsSchema.safeParse([v, v]).success).toBe(false);
  });

  it("experiment issues file is valid, disjoint from the seed ids and invalid sets are rejected", () => {
    const raw = readJson("eval/experiment-issues.json");
    expect(experimentIssuesSchema.safeParse(raw).success).toBe(true);
    const issues = raw as { id: string; kind: string }[];
    for (const kind of ["backend", "frontend", "cross"])
      expect(issues.filter((i) => i.kind === kind).length).toBeGreaterThanOrEqual(3);
    const seed = readJson("sandbox/seed-issues.json") as { id: string }[];
    const seedIds = new Set(seed.map((s) => s.id));
    expect(issues.filter((i) => seedIds.has(i.id))).toEqual([]);

    const item = (id: string, kind: string): Record<string, unknown> => ({
      id,
      kind,
      title: "t",
      body: "b",
      criteria: ["c"],
    });
    const valid = [item("A", "backend"), item("B", "frontend"), item("C", "cross")];
    expect(experimentIssuesSchema.safeParse(valid).success).toBe(true);
    expect(experimentIssuesSchema.safeParse([...valid, item("A", "backend")]).success).toBe(false);
    const noCriteria = { ...item("A", "backend"), criteria: [] };
    expect(experimentIssuesSchema.safeParse([noCriteria, ...valid.slice(1)]).success).toBe(false);
    expect(experimentIssuesSchema.safeParse([...valid, item("D", "devops")]).success).toBe(false);
    expect(experimentIssuesSchema.safeParse(valid.slice(0, 2)).success).toBe(false);
  });
});
