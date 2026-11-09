import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLedgerRepository, openDatabase } from "@friday/infrastructure";
import { report } from "../src/report.ts";
import { root } from "./helpers.ts";

const USAGE = "Uso: friday report --db <arquivo> --project <id>\n";
const usage = { stdout: "", stderr: USAGE, code: 2 };

function seed(withUnknown: boolean): string {
  const file = join(mkdtempSync(join(tmpdir(), "friday-report-")), "friday.db");
  const db = openDatabase(file);
  db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run("p");
  db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run("q");
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
  repo.record({ ...base, runId: "r3", issueId: 8, costUsd: 0.25 });
  if (withUnknown) {
    repo.record({ ...base, runId: "r4", issueId: 9, costUsd: 0.8, costUnknown: true });
  }
  db.close();
  return file;
}

const args = (db: string, project: string) => ["report", "--db", db, "--project", project];

describe("friday report", () => {
  it("prints cost per issue and the mean", () => {
    expect(report(args(seed(false), "p"))).toEqual({
      stdout: "Custo por issue:\n#7 0.75 USD\n#8 0.25 USD\nMédia: 0.50 USD\n",
      stderr: "",
      code: 0,
    });
  });

  it("marks an issue with unknown cost", () => {
    expect(report(args(seed(true), "p"))).toEqual({
      stdout:
        "Custo por issue:\n#7 0.75 USD\n#8 0.25 USD\n#9 0.80 USD (custo desconhecido)\nMédia: 0.60 USD\n",
      stderr: "",
      code: 0,
    });
  });

  it("prints the empty message for a project without runs", () => {
    expect(report(args(seed(false), "q"))).toEqual({
      stdout: "Custo por issue:\nSem runs registradas.\n",
      stderr: "",
      code: 0,
    });
  });

  it("rejects missing flags, unknown and repeated arguments with usage and code 2", () => {
    const db = seed(false);
    expect(report(["report"])).toEqual(usage);
    expect(report(["report", "--db", db])).toEqual(usage);
    expect(report(["report", "--project", "p"])).toEqual(usage);
    expect(report(["report", "--db", "", "--project", "p"])).toEqual(usage);
    expect(report(["report", "--db", db, "--project", ""])).toEqual(usage);
    expect(report([...args(db, "p"), "--foo", "x"])).toEqual(usage);
    expect(report([...args(db, "p"), "--project", "q"])).toEqual(usage);
    expect(report([...args(db, "p"), "--db", db])).toEqual(usage);
    expect(report([...args(db, "p"), "extra"])).toEqual(usage);
  });

  it("index dispatches the report command", () => {
    const run = (...a: string[]) => {
      const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", "report", ...a], {
        cwd: root,
        encoding: "utf8",
      });
      return { stdout: r.stdout, stderr: r.stderr, code: r.status };
    };
    expect(run()).toEqual(usage);
    expect(run("--db", seed(false), "--project", "p")).toEqual({
      stdout: "Custo por issue:\n#7 0.75 USD\n#8 0.25 USD\nMédia: 0.50 USD\n",
      stderr: "",
      code: 0,
    });
  }, 30_000);
});
