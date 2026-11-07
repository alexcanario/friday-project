import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTickConfig } from "../src/index.ts";

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");

describe("readTickConfig", () => {
  it("rereads factory.yaml and defaults max_concurrent_runs to 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-tick-"));
    cpSync(fixture, dir, { recursive: true });
    const file = join(dir, "factory.yaml");
    const original = readFileSync(file, "utf8");
    expect(readTickConfig(dir)).toEqual({
      enabled: true,
      maxConcurrentRuns: 1,
      perIssueUsd: 5,
      perDayUsd: 10,
    });
    writeFileSync(file, original.replace("enabled: true", "enabled: false"));
    expect(readTickConfig(dir)?.enabled).toBe(false);
    writeFileSync(file, original.replace("limits:\n", "limits:\n  max_concurrent_runs: 2\n"));
    expect(readTickConfig(dir)).toEqual({
      enabled: true,
      maxConcurrentRuns: 2,
      perIssueUsd: 5,
      perDayUsd: 10,
    });
    writeFileSync(file, "enabled: [");
    expect(readTickConfig(dir)).toBeNull();
  });

  it("reads the issue and day caps", () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-tick-"));
    cpSync(fixture, dir, { recursive: true });
    const file = join(dir, "factory.yaml");
    const original = readFileSync(file, "utf8");
    expect(original).toContain("per_day_usd: 10");
    expect(original).toContain("per_issue_usd: 5");
    expect(readTickConfig(dir)).toMatchObject({ perIssueUsd: 5, perDayUsd: 10 });
    writeFileSync(
      file,
      original
        .replace("per_day_usd: 10", "per_day_usd: 20")
        .replace("per_issue_usd: 5", "per_issue_usd: 7"),
    );
    expect(readTickConfig(dir)).toMatchObject({ perIssueUsd: 7, perDayUsd: 20 });
    writeFileSync(file, "enabled: [");
    expect(readTickConfig(dir)).toBeNull();
  });
});
