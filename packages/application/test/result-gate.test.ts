import type { AgentConfig } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { checkResult, FakeResultStore, FakeRunLookup, type GateRequest } from "../src/index.ts";

const HEAD = "a".repeat(40);
const QA_OK = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "pnpm test saiu 0", screenshots: [] }],
  notChecked: [],
};
const QA_BAD = { verdict: "pass", criteria: [], notChecked: [] };
const WORK_OK = { summary: "ok", headSha: HEAD, changedFiles: [], notDone: [] };
const CRITERIA_OK = {
  criteria: [{ index: 1, claim: "c", proof: { kind: "command", command: "pnpm test" } }],
};
const VERDICT_OK = {
  verdict: "approve",
  headSha: HEAD,
  rules: [1, 2, 3, 4, 5].map((rule) => ({ rule, answer: "yes", evidence: "ok" })),
  findings: [],
};
const QA_AGENT: Pick<AgentConfig, "states" | "mcp_tools"> = {
  states: ["QA"],
  mcp_tools: ["qa_report"],
};
const ALL_AGENT: Pick<AgentConfig, "states" | "mcp_tools"> = {
  states: ["QA"],
  mcp_tools: ["qa_report", "work_report", "criteria_set", "review_verdict"],
};
const M403 = "Ferramenta não permitida para este papel ou estado da issue.";
const M404 = "A run não está ativa.";
const M409 = "Resultado deste tipo já enviado nesta run.";

const request = (over: Partial<GateRequest> = {}): GateRequest => ({
  runId: "r1",
  tool: "qa_report",
  agent: QA_AGENT,
  issueState: "QA",
  input: QA_OK,
  ...over,
});
const setup = (active = ["r1"]) => {
  const results = new FakeResultStore();
  return { results, deps: { runs: new FakeRunLookup(active), results } };
};

describe("checkResult", () => {
  it("accepts a valid qa report and records it", () => {
    const { deps, results } = setup();
    expect(checkResult(deps, request())).toEqual({ status: 200, kind: "qaReport", value: QA_OK });
    expect(results.records).toHaveLength(1);
    expect(results.records[0]).toMatchObject({ runId: "r1", kind: "qaReport" });
  });

  it("refuses with 403 a tool outside the sheet, the list or the state", () => {
    const { deps, results } = setup();
    const expected = { status: 403, message: M403 };
    expect(checkResult(deps, request({ tool: "git_push" }))).toEqual(expected);
    expect(checkResult(deps, request({ tool: "work_report", input: WORK_OK }))).toEqual(expected);
    expect(checkResult(deps, request({ issueState: "InReview" }))).toEqual(expected);
    expect(results.records).toHaveLength(0);
  });

  it("refuses with 404 when the run is not active", () => {
    const { deps, results } = setup();
    expect(checkResult(deps, request({ runId: "r9" }))).toEqual({ status: 404, message: M404 });
    expect(results.records).toHaveLength(0);
  });

  it("refuses with 409 a second result of the same kind in the same run", () => {
    const { deps, results } = setup(["r1", "r2"]);
    results.record("r1", "qaReport", QA_OK);
    expect(checkResult(deps, request())).toEqual({ status: 409, message: M409 });
    expect(results.records).toHaveLength(1);
    expect(checkResult(deps, request({ runId: "r2" })).status).toBe(200);
    const other = request({ tool: "work_report", agent: ALL_AGENT, input: WORK_OK });
    expect(checkResult(deps, other).status).toBe(200);
  });

  it("refuses with 422 an invalid result and does not consume the single use", () => {
    const { deps, results } = setup();
    const bad = checkResult(deps, request({ input: QA_BAD }));
    expect(bad.status).toBe(422);
    if (bad.status !== 422) throw new Error("expected 422");
    expect(bad.violations.map((v) => v.code)).toContain("pass_without_criteria");
    const extra = checkResult(deps, request({ input: { ...QA_OK, extra: 1 } }));
    if (extra.status !== 422) throw new Error("expected 422");
    expect(extra.violations).toContainEqual(
      expect.objectContaining({ code: "unknown_field", path: "extra" }),
    );
    expect(results.records).toHaveLength(0);
    expect(checkResult(deps, request()).status).toBe(200);
  });

  it("checks the gates in the order 403, 404, 409, 422, 200", () => {
    const { deps, results } = setup();
    results.record("r9", "qaReport", QA_OK);
    const all = request({ runId: "r9", tool: "work_report", input: QA_BAD });
    expect(checkResult(deps, all).status).toBe(403);
    const no404 = request({ runId: "r9", input: QA_BAD });
    expect(checkResult(deps, no404).status).toBe(404);
    const { deps: d2, results: r2 } = setup(["r9"]);
    r2.record("r9", "qaReport", QA_OK);
    expect(checkResult(d2, no404).status).toBe(409);
    const { deps: d3 } = setup(["r9"]);
    expect(checkResult(d3, no404).status).toBe(422);
    expect(checkResult(d3, request({ runId: "r9" })).status).toBe(200);
  });

  it("accepts and refuses each contract on its own tool", () => {
    const base = { agent: ALL_AGENT };
    const run = (tool: string, input: unknown) => {
      const { deps } = setup();
      return checkResult(deps, request({ ...base, tool, input }));
    };
    expect(run("criteria_set", CRITERIA_OK).status).toBe(200);
    expect(run("criteria_set", { criteria: [] }).status).toBe(422);
    expect(run("work_report", WORK_OK).status).toBe(200);
    const badSha = run("work_report", { ...WORK_OK, headSha: "abc" });
    expect(badSha.status === 422 && badSha.violations.map((v) => v.code)).toContain(
      "invalid_head_sha",
    );
    expect(run("review_verdict", VERDICT_OK).status).toBe(200);
    const reject = run("review_verdict", { ...VERDICT_OK, verdict: "reject" });
    expect(reject.status === 422 && reject.violations.map((v) => v.code)).toContain(
      "findings_missing",
    );
  });
});
