import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLedgerRepository, openDatabase } from "@friday/infrastructure";
import { costs } from "../src/costs.ts";

const USAGE = "Uso: friday costs --db <arquivo> --project <id> --issue <n>\n";

function seed(): string {
  const file = join(mkdtempSync(join(tmpdir(), "friday-costs-")), "friday.db");
  const db = openDatabase(file);
  db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run("p");
  const repo = createLedgerRepository(db);
  const base = {
    projectId: "p",
    day: "2026-11-07",
    costUnknown: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    numTurns: null,
  };
  repo.record({ ...base, runId: "r1", issueId: 7, costUsd: 0.25 });
  repo.record({ ...base, runId: "r2", issueId: 7, costUsd: 0.5 });
  db.close();
  return file;
}

describe("friday costs", () => {
  it("prints the issue total, zero for unknown issue and usage error", () => {
    const db = seed();
    const args = (issue: string) => ["costs", "--db", db, "--project", "p", "--issue", issue];
    expect(costs(args("7"))).toEqual({ stdout: "Total: 0.75 USD\n", stderr: "", code: 0 });
    expect(costs(args("999"))).toEqual({ stdout: "Total: 0.00 USD\n", stderr: "", code: 0 });
    const usage = { stdout: "", stderr: USAGE, code: 2 };
    expect(costs(args("abc"))).toEqual(usage);
    expect(costs(["costs", "--db", db, "--project", "p"])).toEqual(usage);
    expect(costs(["costs"])).toEqual(usage);
  });
});
