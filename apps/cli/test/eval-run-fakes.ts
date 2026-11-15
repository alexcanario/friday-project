import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { AgentRunRequest, GitHubPort, RunLookup, WorktreeManager } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import type { ClaudeAgentSdkRuntimeDeps } from "@friday/infrastructure";
import type { ProductionSeams } from "../src/eval-run-production.ts";
import { root } from "./helpers.ts";

export const H = "c".repeat(40);
export const ISSUE = {
  number: 12,
  title: "E1: GET /health",
  body: "Implementar GET /health.",
  labels: ["experimento-d112"],
};
export const CLAIMS = ["GET /health responde 200"];
export const REQUEST = {
  item: { id: "E1", kind: "backend" as const },
  variant: "generic",
  repetition: 1,
  roles: ["generic"],
  maxBudgetUsd: 2,
};

const WORK = { summary: "feito", headSha: H, changedFiles: ["src/Health.cs"], notDone: [] };
const PASS = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "dotnet test", screenshots: [] }],
  notChecked: [],
};
const RULES = [1, 2, 3, 4, 5].map((rule) => ({ rule, answer: "yes", evidence: "ok" }));
const APPROVE = { verdict: "approve", headSha: H, rules: RULES, findings: [], risk: "low" };

const done = (output: unknown, costUsd: number): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: "sonnet",
  costUsd,
  tokens: null,
  numTurns: 1,
  durationMs: 1,
  output,
  violations: [],
});

const created: string[] = [];

/** A copy of `registry/`, an absolute FRIDAY_HOME with the clone, and an empty `tmpRoot`. */
export function workspace() {
  const base = mkdtempSync(join(tmpdir(), "friday-552-"));
  created.push(base);
  const registryRoot = join(base, "registry");
  cpSync(join(root, "registry"), registryRoot, { recursive: true });
  const home = join(base, "home");
  const repoDir = join(home, "repos", "alexcanario__friday-sandbox");
  mkdirSync(repoDir, { recursive: true });
  const tmpRoot = join(base, "tmp");
  mkdirSync(tmpRoot);
  const env: Record<string, string | undefined> = {
    FRIDAY_HOME: home,
    FRIDAY_AUTHOR_TOKEN: "author-tok",
    FRIDAY_REVIEW_TOKEN: "review-tok",
  };
  const edit = (rel: string, from: string, to: string) => {
    const file = join(registryRoot, rel);
    const text = readFileSync(file, "utf8");
    if (!text.includes(from)) throw new Error(`trecho ausente em ${rel}: ${from}`);
    writeFileSync(file, text.replace(from, to));
  };
  return { base, registryRoot, home, repoDir, tmpRoot, env, edit };
}

export function removeWorkspaces(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

type Opts = { createFails?: Error };

/** Seams with no network: a runtime that answers by the state of each request, fake git and GitHub. */
export function fakes(tmpRoot: string, opts: Opts = {}) {
  const seen: string[] = [];
  const activeAtCall: boolean[] = [];
  let lookup: RunLookup | null = null;
  const postReview = vi.fn(async () => ({ id: 5 }));
  const github = {
    listIssuesByLabel: vi.fn(async () => [ISSUE]),
    getCiStatus: vi.fn(async () => ({ headSha: H, state: "success" })),
    postReview,
  } as unknown as GitHubPort;
  const create = opts.createFails;
  const worktrees = {
    create: vi.fn(async () => {
      if (create !== undefined) throw create;
      return { ok: true as const, value: { path: join(tmpRoot, "..", "wt") } };
    }),
    remove: vi.fn(async () => ({ ok: true as const, value: undefined })),
    isClean: vi.fn(async () => true),
  } as unknown as WorktreeManager;
  const respond = (req: AgentRunRequest, deps: ClaudeAgentSdkRuntimeDeps): RunFinished => {
    const runId = req.friday!.runId;
    seen.push(runId);
    activeAtCall.push(deps.runs!.isActive(runId));
    deps.results!.record(runId, "workReport", WORK);
    const state = req.friday!.agent!.states[0];
    if (state === "InProgress") {
      req.friday!.effects!.run.onPrCreated!(77);
      return done(WORK, 0.5);
    }
    return state === "QA" ? done(PASS, 0.25) : done(APPROVE, 0.25);
  };
  let n = 0;
  const seams = {
    createRuntime: vi.fn((deps: ClaudeAgentSdkRuntimeDeps) => {
      lookup = deps.runs ?? null;
      return { run: async (req: AgentRunRequest) => respond(req, deps) };
    }),
    createWorktrees: vi.fn(() => worktrees),
    createGitHost: vi.fn(() => ({ push: async () => ({ sha: H }) })),
    createGitHub: vi.fn(() => github),
    newRunId: () => `run-${++n}`,
    tmpRoot,
  } satisfies ProductionSeams;
  const isActive = (runId: string) => lookup!.isActive(runId);
  return { seams, github, worktrees, postReview, seen, activeAtCall, isActive };
}
