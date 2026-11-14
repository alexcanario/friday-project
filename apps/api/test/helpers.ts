import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createApprovalStore,
  createBreakerStateRepository,
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createProjectEnabledRepository,
  createRunLedgerReader,
  createRunRepository,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import type { ApiDeps } from "../src/index.ts";

export interface Fixture {
  db: FridayDatabase;
  deps: ApiDeps;
  clock: { now: number };
}

export function openFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "friday-api-"));
  const db = openDatabase(join(dir, "friday.db"));
  for (const id of ["p1", "p2"]) db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run(id);
  const clock = { now: 1_000_000 };
  const deps: ApiDeps = {
    events: createEventStore(db),
    issues: createIssueRepository(db),
    runs: createRunRepository(db),
    ledger: createLedgerRepository(db),
    runLedger: createRunLedgerReader(db),
    approvals: createApprovalStore(db),
    breaker: createBreakerStateRepository(db),
    enabled: createProjectEnabledRepository(db),
    now: () => clock.now,
  };
  return { db, deps, clock };
}

export function stateChanged(
  projectId: string,
  issueId: number,
  from: string,
  to: string,
  heldReason: string | null = null,
  at = "2026-11-05T10:00:00.000Z",
) {
  return {
    projectId,
    issueId,
    runId: null,
    type: "StateChanged",
    payload: {
      type: "StateChanged",
      issueId: String(issueId),
      from,
      to,
      trigger: "Admitted",
      heldReason,
      verifyRound: 1,
      qaRound: 2,
      reviewIter: 3,
    },
    actor: "test",
    at,
  };
}

export function seedIssues(f: Fixture): void {
  f.deps.events.append(stateChanged("p1", 14, "Todo", "InProgress"));
  f.deps.events.append(stateChanged("p1", 13, "Backlog", "Todo"));
  f.deps.events.append(stateChanged("p1", 14, "InProgress", "Held", "budget"));
  f.deps.events.append({
    projectId: "p1",
    issueId: 14,
    runId: null,
    type: "Note",
    payload: { text: "x" },
    actor: "test",
    at: "2026-11-05T10:05:00.000Z",
  });
  f.deps.issues.rebuild("p1");
}

export function countRows(db: FridayDatabase): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ["events", "runs", "ledger"]) {
    const r = db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    out[t] = r.n;
  }
  return out;
}
