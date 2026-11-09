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
  issueId: 7,
  numTurns: null,
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

  it("sums cost by issue", () => {
    db = openWithProjects("a", "b");
    const repo = createLedgerRepository(db);
    repo.record(entry("a", "r1", "2026-01-01", 0.25));
    repo.record(entry("a", "r2", "2026-01-02", 0.5));
    repo.record({ ...entry("b", "r3", "2026-01-01", 9), issueId: 7 });
    repo.record({ ...entry("a", "r4", "2026-01-01", 0.5), issueId: 9, costUnknown: true });
    expect(repo.sumByIssue("a", 7)).toEqual({ costUsd: 0.75, anyCostUnknown: false });
    expect(repo.sumByIssue("a", 8)).toEqual({ costUsd: 0, anyCostUnknown: false });
    expect(repo.sumByIssue("a", 9)).toEqual({ costUsd: 0.5, anyCostUnknown: true });
  });

  it("stores issue_id and num_turns columns", () => {
    db = openWithProjects("a");
    const repo = createLedgerRepository(db);
    repo.record(entry("a", "r1", "2026-01-01", 1));
    repo.record({ ...entry("a", "r2", "2026-01-01", 1), numTurns: 4 });
    const rows = db.sqlite
      .prepare("SELECT issue_id, num_turns FROM ledger ORDER BY id")
      .all() as Record<string, unknown>[];
    expect(rows).toEqual([
      { issue_id: 7, num_turns: null },
      { issue_id: 7, num_turns: 4 },
    ]);
  });

  it("listIssueSums sums per issue, ordered, per project", () => {
    db = openWithProjects("p", "q");
    const repo = createLedgerRepository(db);
    repo.record({ ...entry("p", "r1", "2026-01-01", 0.8), issueId: 9, costUnknown: true });
    repo.record({ ...entry("p", "r2", "2026-01-01", 0.25), issueId: 8 });
    repo.record(entry("p", "r3", "2026-01-01", 0.25));
    repo.record(entry("p", "r4", "2026-01-02", 0.5));
    repo.record(entry("q", "r5", "2026-01-01", 5));
    expect(repo.listIssueSums("p")).toEqual([
      { issueId: 7, costUsd: 0.75, anyCostUnknown: false },
      { issueId: 8, costUsd: 0.25, anyCostUnknown: false },
      { issueId: 9, costUsd: 0.8, anyCostUnknown: true },
    ]);
    db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run("empty");
    expect(repo.listIssueSums("empty")).toEqual([]);
  });
});
