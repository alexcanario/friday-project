import { afterEach, describe, expect, it } from "vitest";
import { createLedgerRepository, createRunLedgerReader } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

const entry = (
  projectId: string,
  runId: string,
  costUsd: number | null,
  numTurns: number | null,
  costUnknown = costUsd === null,
) => ({
  projectId,
  runId,
  day: "2026-01-01",
  costUsd,
  costUnknown,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  issueId: 7,
  numTurns,
});

describe("sqlite run ledger reader", () => {
  it("sums cost and turns per run, null when missing or unknown, scoped to the project", () => {
    db = openWithProjects("a", "b");
    const repo = createLedgerRepository(db);
    const reader = createRunLedgerReader(db);
    expect(reader.sumByRun("a", "r1")).toEqual({ costUsd: null, numTurns: null });

    repo.record(entry("a", "r1", 0.25, 2));
    repo.record(entry("a", "r1", 0.5, 3));
    repo.record(entry("b", "r1", 9, 9));
    expect(reader.sumByRun("a", "r1")).toEqual({ costUsd: 0.75, numTurns: 5 });

    repo.record(entry("a", "r2", null, 4, true));
    repo.record(entry("a", "r2", 0.5, null));
    expect(reader.sumByRun("a", "r2")).toEqual({ costUsd: null, numTurns: 4 });
    expect(reader.sumByRun("b", "r1")).toEqual({ costUsd: 9, numTurns: 9 });
  });
});
