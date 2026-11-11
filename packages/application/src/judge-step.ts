import { validateContract, type ReviewVerdict, type Violation } from "@friday/contracts";
import type { RunHeldReason, WorkflowInput } from "@friday/domain";
import type { AgentRunOptions } from "./agent-run-options.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import type { GitHubPort } from "./github-port.ts";
import { heldReasonFor } from "./held-reason-for.ts";
import { renderReviewBody, reviewEventFor } from "./judge-review.ts";
import {
  JUDGE_ALLOWED_MCP,
  JUDGE_ALLOWED_TOOLS,
  chooseJudgeRole,
  parseDeclaredRisk,
} from "./judge-role.ts";
import type { StaleVerdicts } from "./stale-verdicts.ts";

type ReviewApproved = Extract<WorkflowInput, { type: "ReviewApproved" }>;

/** How the Judge obtains the review token: a variable name (D53) or the App token provider (D90). */
export type ReviewCredential =
  { mode: "env"; tokenEnv: string } | { mode: "app"; getToken: () => Promise<string> };

export type JudgeStepDeps = {
  runtime: AgentRuntime;
  stale: StaleVerdicts;
  readPrHead: (pr: number) => Promise<string>;
  reviewer: (token: string) => Pick<GitHubPort, "postReview">;
  env: Record<string, string | undefined>;
  review: ReviewCredential;
  agents: Record<"judge" | "judge-strong", AgentRunOptions>;
};

export type JudgeStepInput = {
  projectId: string;
  issue: { id: number; body: string; labels: string[] };
  pr: number;
  cwd: string;
  prompt: string;
  configRoot: string;
};

export type JudgeStepOutcome =
  | { kind: "approved"; input: ReviewApproved; reviewId: number }
  | {
      kind: "changes_requested";
      input: { type: "ChangesRequested" };
      feedback: string;
      reviewId: number;
    }
  | { kind: "rejected"; input: { type: "ReviewRejected" }; reviewId: number }
  | { kind: "head_mismatch"; input: ReviewApproved }
  | { kind: "stale" }
  | { kind: "invalid"; violations: Violation[] }
  | { kind: "held"; input: { type: "RunHeld"; reason: RunHeldReason } };

function readEnvToken(env: Record<string, string | undefined>, name: string): string {
  const token = env[name];
  if (token === undefined || token.trim() === "") {
    throw new Error(`A variável de ambiente ${name} não está definida.`);
  }
  return token;
}

/** Reads the review token; in app mode every call asks the provider, which renews near expiry. */
async function readToken(deps: JudgeStepDeps): Promise<string> {
  const { review } = deps;
  if (review.mode === "env") return readEnvToken(deps.env, review.tokenEnv);
  const token = await review.getToken();
  if (token.trim() === "") throw new Error("O token de revisão do App está vazio.");
  return token;
}

function misconfigured(agent: AgentRunOptions): boolean {
  const tools = new Set<string>(JUDGE_ALLOWED_TOOLS);
  const mcp = new Set<string>(JUDGE_ALLOWED_MCP);
  return agent.tools.some((t) => !tools.has(t)) || agent.allowedTools.some((t) => !mcp.has(t));
}

const held = (reason: RunHeldReason): JudgeStepOutcome => ({
  kind: "held",
  input: { type: "RunHeld", reason },
});

/** Maps the posted verdict to the step outcome. */
function outcomeFor(verdict: ReviewVerdict, reviewId: number, prHeadSha: string): JudgeStepOutcome {
  if (verdict.verdict === "approve") {
    return {
      kind: "approved",
      reviewId,
      input: { type: "ReviewApproved", headSha: verdict.headSha, prHeadSha },
    };
  }
  if (verdict.verdict === "reject") {
    return { kind: "rejected", reviewId, input: { type: "ReviewRejected" } };
  }
  const feedback = verdict.findings.map((f, i) => `${i + 1}. ${f}`).join("\n");
  return { kind: "changes_requested", reviewId, feedback, input: { type: "ChangesRequested" } };
}

type Validated = { ok: true; verdict: ReviewVerdict } | { ok: false; outcome: JudgeStepOutcome };

/** Runs one agent role and validates its output into a verdict or an outcome. */
async function runAndValidate(
  deps: JudgeStepDeps,
  input: JudgeStepInput,
  role: "judge" | "judge-strong",
): Promise<Validated> {
  const agent = deps.agents[role];
  if (misconfigured(agent)) return { ok: false, outcome: held("RunMisconfigured") };
  const finished = await deps.runtime.run({
    cwd: input.cwd,
    prompt: input.prompt,
    configRoot: input.configRoot,
    agent,
  });
  if (finished.status === "invalid_output") {
    const violations = finished.violations as Violation[];
    return { ok: false, outcome: { kind: "invalid", violations } };
  }
  const reason = heldReasonFor(finished);
  if (reason !== null) return { ok: false, outcome: held(reason) };
  const parsed = validateContract("reviewVerdict", finished.output);
  if (!parsed.ok) return { ok: false, outcome: { kind: "invalid", violations: parsed.violations } };
  return { ok: true, verdict: parsed.value };
}

export async function runJudgeStep(
  deps: JudgeStepDeps,
  input: JudgeStepInput,
): Promise<JudgeStepOutcome> {
  await readToken(deps);
  const role = chooseJudgeRole({
    declaredRisk: parseDeclaredRisk(input.issue.body),
    labels: input.issue.labels,
  });
  let result = await runAndValidate(deps, input, role);
  // D39: the cheaper judge only runs for declared low risk; any higher risk repeats once.
  if (result.ok && role === "judge" && result.verdict.risk !== "low") {
    result = await runAndValidate(deps, input, "judge-strong");
  }
  if (!result.ok) return result.outcome;
  const verdict = result.verdict;
  const { projectId, issue, pr } = input;
  if (deps.stale.isStale(projectId, issue.id, verdict.headSha)) return { kind: "stale" };
  const prHeadSha = await deps.readPrHead(pr);
  if (prHeadSha !== verdict.headSha) {
    deps.stale.markStale(projectId, issue.id, verdict.headSha);
    return {
      kind: "head_mismatch",
      input: { type: "ReviewApproved", headSha: verdict.headSha, prHeadSha },
    };
  }
  // Fresh token right before posting: the run duration must not eat the renewal margin.
  const token = await readToken(deps);
  const { id: reviewId } = await deps.reviewer(token).postReview(pr, {
    commitId: verdict.headSha,
    body: renderReviewBody(verdict),
    event: reviewEventFor(verdict.verdict),
  });
  return outcomeFor(verdict, reviewId, prHeadSha);
}
