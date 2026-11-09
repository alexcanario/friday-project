import { createLedgerRepository, openDatabase } from "@friday/infrastructure";

const USAGE = "Uso: friday report --db <arquivo> --project <id>\n";

type Result = { stdout: string; stderr: string; code: number };

function parse(args: string[]): { db: string; project: string } | null {
  const values = new Map<string, string>();
  if (args.length !== 5) return null;
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (key !== "--db" && key !== "--project") return null;
    if (value === undefined || value === "" || values.has(key)) return null;
    values.set(key, value);
  }
  const db = values.get("--db");
  const project = values.get("--project");
  return db === undefined || project === undefined ? null : { db, project };
}

export function report(args: string[]): Result {
  const parsed = parse(args);
  if (parsed === null) return { stdout: "", stderr: USAGE, code: 2 };
  const db = openDatabase(parsed.db);
  try {
    const sums = createLedgerRepository(db).listIssueSums(parsed.project);
    if (sums.length === 0) {
      return { stdout: "Custo por issue:\nSem runs registradas.\n", stderr: "", code: 0 };
    }
    const lines = sums.map(
      (s) =>
        `#${s.issueId} ${s.costUsd.toFixed(2)} USD${s.anyCostUnknown ? " (custo desconhecido)" : ""}`,
    );
    const mean = sums.reduce((acc, s) => acc + s.costUsd, 0) / sums.length;
    return {
      stdout: `Custo por issue:\n${lines.join("\n")}\nMédia: ${mean.toFixed(2)} USD\n`,
      stderr: "",
      code: 0,
    };
  } finally {
    db.close();
  }
}
