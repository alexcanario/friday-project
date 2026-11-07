import { createLedgerRepository, openDatabase } from "@friday/infrastructure";

const USAGE = "Uso: friday costs --db <arquivo> --project <id> --issue <n>\n";

type Result = { stdout: string; stderr: string; code: number };

function parse(args: string[]): { db: string; project: string; issue: number } | null {
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (key === undefined || value === undefined || value === "") return null;
    values.set(key, value);
  }
  const db = values.get("--db");
  const project = values.get("--project");
  const issue = values.get("--issue");
  if (db === undefined || project === undefined || issue === undefined) return null;
  if (!/^\d+$/.test(issue)) return null;
  return { db, project, issue: Number(issue) };
}

export function costs(args: string[]): Result {
  const parsed = parse(args);
  if (parsed === null) return { stdout: "", stderr: USAGE, code: 2 };
  const db = openDatabase(parsed.db);
  try {
    const sum = createLedgerRepository(db).sumByIssue(parsed.project, parsed.issue);
    return { stdout: `Total: ${sum.costUsd.toFixed(2)} USD\n`, stderr: "", code: 0 };
  } finally {
    db.close();
  }
}
