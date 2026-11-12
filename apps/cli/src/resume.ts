import { parseArgs } from "node:util";
import type { EventStore, IssueRepository } from "@friday/application";
import { applyInputs } from "./apply-inputs.ts";

export type ResumeDeps = {
  events: EventStore;
  issues: IssueRepository;
  now: () => number;
  close(): void;
};

type Output = { stdout: string; stderr: string; code: number };

const USAGE = "Uso: friday resume <issue> --db <arquivo> --project <id>\n";
const usage: Output = { stdout: "", stderr: USAGE, code: 2 };
const fail = (stderr: string): Output => ({ stdout: "", stderr, code: 1 });

type Parsed = { db: string; project: string; issue: number };

function parse(args: string[]): Parsed | null {
  if (args[0] !== "resume") return null;
  let values: { db?: string; project?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: args.slice(1),
      options: { db: { type: "string" }, project: { type: "string" } },
      strict: true,
      allowPositionals: true,
    }));
  } catch {
    return null;
  }
  const { db, project } = values;
  if (db === undefined || db === "" || project === undefined || project === "") return null;
  const [raw, ...rest] = positionals;
  if (raw === undefined || rest.length > 0 || !/^[1-9][0-9]*$/.test(raw)) return null;
  const issue = Number(raw);
  return Number.isSafeInteger(issue) ? { db, project, issue } : null;
}

function execute(deps: ResumeDeps, { project, issue }: Parsed): Output {
  const row = deps.issues.get(project, issue);
  if (row === null) return fail(`Issue ${issue} não encontrada.\n`);
  if (row.state !== "Held") return fail(`A issue ${issue} não está retida (Held).\n`);
  try {
    const before = deps.events.list(project, issue).length;
    applyInputs(deps, { projectId: project, issueId: issue }, [{ type: "Resumed" }]);
    if (deps.events.list(project, issue).length !== before + 1) {
      return fail("Falha ao retomar a issue.\n");
    }
  } catch {
    return fail("Falha ao retomar a issue.\n");
  }
  return { stdout: `Issue ${issue} retomada.\n`, stderr: "", code: 0 };
}

export async function runResume(
  args: string[],
  open: (dbPath: string) => ResumeDeps,
): Promise<Output> {
  const parsed = parse(args);
  if (parsed === null) return usage;
  let deps: ResumeDeps;
  try {
    deps = open(parsed.db);
  } catch {
    return fail("Falha ao abrir o banco.\n");
  }
  try {
    return execute(deps, parsed);
  } catch {
    return fail("Falha ao retomar a issue.\n");
  } finally {
    try {
      deps.close();
    } catch {
      // a close failure must never replace the result of execute
    }
  }
}
