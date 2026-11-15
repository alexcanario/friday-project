import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { experimentRunsSchema, type ExperimentRun } from "@friday/contracts";
import { createExperimentRunFile } from "../src/index.ts";

const run = (itemId: string, costUsd: number | null = 0.5): ExperimentRun => ({
  itemId,
  kind: "backend",
  variant: "generic",
  status: "done",
  costUsd,
  rounds: 1,
  judgeFirstRound: true,
  durationS: 10,
  peakContextTokens: 1000,
});

describe("createExperimentRunFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "friday-runs-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a valid list after each append and refuses invalid runs and existing files", () => {
    const path = join(dir, "runs.json");
    const file = createExperimentRunFile(path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([]);

    file.append(run("E1"));
    file.append(run("E2"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(2);
    file.append(run("E3"));
    const parsed = experimentRunsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.map((r) => r.itemId)).toEqual(["E1", "E2", "E3"]);

    expect(() => file.append(run("E4", -1))).toThrow();
    const after = experimentRunsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    expect(after).toHaveLength(3);

    file.append(run("E5"));
    expect(experimentRunsSchema.parse(JSON.parse(readFileSync(path, "utf8")))).toHaveLength(4);

    const existing = join(dir, "existing.json");
    writeFileSync(existing, "keep");
    expect(() => createExperimentRunFile(existing)).toThrow(
      `Erro: o arquivo já existe: ${existing}`,
    );
    expect(readFileSync(existing, "utf8")).toBe("keep");
  });
});
