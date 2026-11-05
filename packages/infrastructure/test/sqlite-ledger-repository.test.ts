import { afterEach, describe, expect, it } from "vitest";
import { createLedgerRepository } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

const entry = (projectId: string, runId: string, day: string, costUsd: number | null) => ({
  projectId,
  runId,
  day,
  costUsd,
  costUnknown: costUsd === null,
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 3,
  cacheCreationTokens: 4,
});

describe("sqlite ledger repository", () => {
  it("sums cost by project and day", () => {
    db = openWithProjects("a", "b");
    const repo = createLedgerRepository(db);
    repo.record(entry("a", "r1", "2026-01-01", 1.5));
    repo.record(entry("a", "r2", "2026-01-01", 0.25));
    repo.record(entry("a", "r3", "2026-01-02", 9));
    repo.record(entry("b", "r4", "2026-01-01", 7));
    expect(repo.sumByDay("a", "2026-01-01")).toEqual({ costUsd: 1.75, anyCostUnknown: false });
    repo.record(entry("a", "r5", "2026-01-01", null));
    expect(repo.sumByDay("a", "2026-01-01")).toEqual({ costUsd: 1.75, anyCostUnknown: true });
    expect(repo.sumByDay("a", "2030-01-01")).toEqual({ costUsd: 0, anyCostUnknown: false });
    const row = db.sqlite.prepare("SELECT * FROM ledger WHERE run_id = 'r1'").get() as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({ input_tokens: 10, output_tokens: 20, cost_unknown: 0 });
  });
});
