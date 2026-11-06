import { parseArgs } from "node:util";

export type PendingApproval = {
  id: string;
  issueId: number;
  pr: number;
  headSha: string;
  tier: string;
  requestedAt: number;
  expiresAt: number;
};

export type DecisionResult =
  | { kind: "merged"; sha: string }
  | { kind: "denied" }
  | { kind: "unknown" | "already_decided" | "expired" | "head_changed" | "merge_blocked" };

export interface ApprovalsClient {
  list(project: string): Promise<PendingApproval[]>;
  decide(id: string, decision: "approve" | "deny"): Promise<DecisionResult>;
  close?(): void;
}

type Output = { stdout: string; stderr: string; code: number };

export const unconfiguredClient: ApprovalsClient = {
  list: () => Promise.reject(new Error("cliente de aprovações não configurado")),
  decide: () => Promise.reject(new Error("cliente de aprovações não configurado")),
};

const USAGE =
  "Uso: friday approvals list --db <arquivo> --project <id>\n" +
  "     friday approvals approve <id> --db <arquivo>\n" +
  "     friday approvals deny <id> --db <arquivo>\n";

const usage: Output = { stdout: "", stderr: USAGE, code: 2 };
const fail = (stderr: string): Output => ({ stdout: "", stderr, code: 1 });

const REFUSALS = {
  unknown: "Aprovação não encontrada.\n",
  already_decided: "Aprovação já decidida.\n",
  expired: "Aprovação expirada.\n",
  head_changed: "O PR mudou depois do pedido de aprovação.\n",
  merge_blocked: "Merge recusado pelo GitHub.\n",
} as const;

type Parsed =
  | { command: "list"; db: string; project: string }
  | { command: "approve" | "deny"; db: string; id: string };

function parse(args: string[]): Parsed | null {
  if (args[0] !== "approvals") return null;
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
  if (db === undefined || db === "") return null;
  const [command, id, ...rest] = positionals;
  if (command === "list") {
    if (id !== undefined || project === undefined || project === "") return null;
    return { command, db, project };
  }
  if (command !== "approve" && command !== "deny") return null;
  if (id === undefined || id === "" || rest.length > 0 || project !== undefined) return null;
  return { command, db, id };
}

function formatList(items: PendingApproval[]): string {
  if (items.length === 0) return "Nenhuma aprovação pendente.\n";
  return items
    .map(
      (a) =>
        `${a.id}\tPR #${a.pr}\tissue #${a.issueId}\t${a.tier}\texpira ${new Date(a.expiresAt).toISOString()}\n`,
    )
    .join("");
}

async function execute(client: ApprovalsClient, parsed: Parsed): Promise<Output> {
  if (parsed.command === "list") {
    try {
      return { stdout: formatList(await client.list(parsed.project)), stderr: "", code: 0 };
    } catch {
      return fail("Falha ao listar as aprovações.\n");
    }
  }
  let result: DecisionResult;
  try {
    result = await client.decide(parsed.id, parsed.command);
  } catch {
    return fail("Falha ao decidir a aprovação.\n");
  }
  if (result.kind === "merged") {
    return { stdout: `Aprovação ${parsed.id} mesclada: ${result.sha}\n`, stderr: "", code: 0 };
  }
  if (result.kind === "denied") {
    return { stdout: `Aprovação ${parsed.id} negada.\n`, stderr: "", code: 0 };
  }
  return fail(REFUSALS[result.kind]);
}

export async function runApprovals(
  args: string[],
  open: (dbPath: string) => ApprovalsClient,
): Promise<Output> {
  const parsed = parse(args);
  if (parsed === null) return usage;
  const client = open(parsed.db);
  try {
    return await execute(client, parsed);
  } finally {
    client.close?.();
  }
}
