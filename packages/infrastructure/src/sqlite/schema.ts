import type { RunRecordStatus } from "@friday/application";
import type { Risk } from "@friday/domain";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    method: text("method").notNull().default("agile"),
    profile: text("profile"),
  },
  (t) => [check("projects_method_check", sql`${t.method} IN ('agile', 'lens')`)],
);

const projectId = () =>
  text("project_id")
    .notNull()
    .references(() => projects.id);

export const issues = sqliteTable(
  "issues",
  {
    projectId: projectId(),
    id: integer("id").notNull(),
    state: text("state").notNull(),
    heldReason: text("held_reason"),
    verifyRound: integer("verify_round").notNull().default(0),
    qaRound: integer("qa_round").notNull().default(0),
    reviewIter: integer("review_iter").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.id] })],
);

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: projectId(),
  issueId: integer("issue_id").notNull(),
  phase: text("phase"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  status: text("status").$type<RunRecordStatus>().notNull().default("running"),
});

export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    issueId: integer("issue_id"),
    runId: text("run_id"),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    actor: text("actor").notNull(),
    at: text("at").notNull(),
  },
  (t) => [index("events_project_issue_idx").on(t.projectId, t.issueId)],
);

export const ledger = sqliteTable("ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: projectId(),
  runId: text("run_id").notNull(),
  day: text("day").notNull(),
  costUsd: real("cost_usd"),
  costUnknown: integer("cost_unknown").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
  issueId: integer("issue_id").notNull().default(0),
  numTurns: integer("num_turns"),
});

export const breakerState = sqliteTable("breaker_state", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id),
  openedAt: text("opened_at"),
  failuresJson: text("failures_json").notNull().default("[]"),
});

export const runResults = sqliteTable(
  "run_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: projectId(),
    runId: text("run_id").notNull(),
    kind: text("kind").notNull(),
    valueJson: text("value_json").notNull(),
  },
  (t) => [uniqueIndex("run_results_run_kind_idx").on(t.runId, t.kind)],
);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  projectId: projectId(),
  issueId: integer("issue_id").notNull(),
  pr: integer("pr").notNull(),
  headSha: text("head_sha").notNull(),
  tier: text("tier").$type<Risk>().notNull(),
  requestedAt: integer("requested_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  decision: text("decision").$type<"approved" | "denied">(),
  decidedAt: integer("decided_at"),
  decidedBy: text("decided_by"),
});
