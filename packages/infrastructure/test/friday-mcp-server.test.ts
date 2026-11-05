import { FakeResultStore, FakeRunLookup } from "@friday/application";
import type { AgentConfig } from "@friday/contracts";
import type { IssueState } from "@friday/domain";
import { describe, expect, it } from "vitest";
import { createFridayMcpServer } from "../src/index.ts";

const QA_OK = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "pnpm test saiu 0", screenshots: [] }],
  notChecked: [],
};
const QA_BAD = { verdict: "pass", criteria: [], notChecked: [] };
const make = (
  mcp_tools: AgentConfig["mcp_tools"],
  opts: { active?: string[]; state?: () => IssueState } = {},
) =>
  createFridayMcpServer({
    runId: "r1",
    agent: { states: ["QA"], mcp_tools },
    getIssueState: opts.state ?? (() => "QA"),
    runs: new FakeRunLookup(opts.active ?? ["r1"]),
    results: new FakeResultStore(),
  });
const text = (t: string, isError?: true) => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError } : {}),
});

describe("createFridayMcpServer", () => {
  it("registers only the result tools listed in the sheet, in sheet order", () => {
    const both = make(["qa_report", "criteria_set"]);
    expect(both.toolNames).toEqual(["mcp__friday__qa_report", "mcp__friday__criteria_set"]);
    expect(Object.keys(both.handlers)).toEqual(["qa_report", "criteria_set"]);
    expect(both.server.type).toBe("sdk");
    expect(both.server.name).toBe("friday");
    const one = make(["qa_report"]);
    expect(one.toolNames).not.toContain("mcp__friday__criteria_set");
    expect(one.toolNames).not.toContain("mcp__friday__work_report");
    expect(one.handlers.work_report).toBeUndefined();
    expect(make([]).toolNames).toEqual([]);
  });

  it("answers 200 without isError and refusals with isError and the violations", async () => {
    const { handlers } = make(["qa_report"]);
    const first = await handlers.qa_report!(QA_OK);
    expect(first).toEqual(text("200: resultado aceito."));
    expect("isError" in first).toBe(false);
    expect(await handlers.qa_report!(QA_OK)).toEqual(
      text("409: Resultado deste tipo já enviado nesta run.", true),
    );
    const fresh = make(["qa_report"]).handlers;
    expect(await fresh.qa_report!(QA_BAD)).toEqual(
      text("422: Relatório de QA com veredito pass exige ao menos um critério (criteria).", true),
    );
    const inactive = make(["qa_report"], { active: [] }).handlers;
    expect(await inactive.qa_report!(QA_OK)).toEqual(text("404: A run não está ativa.", true));
  });

  it("reads the issue state on every call", async () => {
    let state: IssueState = "InReview";
    const { handlers } = make(["qa_report"], { state: () => state });
    expect(await handlers.qa_report!(QA_OK)).toEqual(
      text("403: Ferramenta não permitida para este papel ou estado da issue.", true),
    );
    state = "QA";
    expect(await handlers.qa_report!(QA_OK)).toEqual(text("200: resultado aceito."));
  });
});
