import { describe, expect, it } from "vitest";
import { initMatchesSheet, secondCallDenied } from "./live-helpers.ts";

const BACKEND_TOOLS = ["Read", "Glob", "Grep", "Bash", "Edit", "Write"] as const;
const MCP_TOOLS = ["work_report", "git_push", "pr_create", "pr_diff", "issue_comment"] as const;
const sheet = {
  tools: [...BACKEND_TOOLS],
  mcp_tools: [...MCP_TOOLS],
  output: "workReport" as const,
};
const exposed = [...BACKEND_TOOLS, ...MCP_TOOLS.map((t) => `mcp__friday__${t}`)];
const friday = [{ name: "friday", status: "connected" }];

describe("live helpers", () => {
  it("initMatchesSheet accepts the sheet with StructuredOutput and rejects extra, missing, output-less and foreign-server cases", () => {
    const tools = [...exposed, "StructuredOutput"];
    expect(initMatchesSheet({ tools, mcp_servers: friday }, sheet)).toBe(true);
    expect(initMatchesSheet({ tools: [...tools].reverse(), mcp_servers: friday }, sheet)).toBe(
      true,
    );
    const noOutput = { tools: sheet.tools, mcp_tools: sheet.mcp_tools };
    expect(initMatchesSheet({ tools, mcp_servers: friday }, noOutput)).toBe(false);
    expect(initMatchesSheet({ tools: exposed, mcp_servers: friday }, sheet)).toBe(false);
    expect(initMatchesSheet({ tools: [...tools, "WebFetch"], mcp_servers: friday }, sheet)).toBe(
      false,
    );
    expect(initMatchesSheet({ tools: tools.slice(1), mcp_servers: friday }, sheet)).toBe(false);
    const foreign = [...friday, { name: "other", status: "connected" }];
    expect(initMatchesSheet({ tools, mcp_servers: foreign }, sheet)).toBe(false);
  });

  it("secondCallDenied accepts 200 then 409 and rejects the rest", () => {
    expect(secondCallDenied(["200: resultado aceito.", "409: x"])).toBe(true);
    expect(secondCallDenied(["422: x", "200: resultado aceito.", "409: x"])).toBe(true);
    expect(secondCallDenied(["200: resultado aceito.", "200: resultado aceito."])).toBe(false);
    expect(secondCallDenied(["409: x"])).toBe(false);
    expect(secondCallDenied([])).toBe(false);
  });
});
