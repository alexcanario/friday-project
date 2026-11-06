import { describe, expect, it } from "vitest";
import { checkEffect } from "../src/index.ts";

const agent = {
  states: ["QA", "InReview"] as ("QA" | "InReview")[],
  mcp_tools: ["git_push", "issue_comment"] as ("git_push" | "issue_comment")[],
};
const FORBIDDEN = {
  status: 403,
  message: "Ferramenta não permitida para este papel ou estado da issue.",
};

describe("checkEffect", () => {
  it("answers 200, 403 and 404 in that order of precedence", () => {
    expect(checkEffect({ tool: "git_push", agent, issueState: "QA", runActive: true })).toEqual({
      status: 200,
    });
    expect(checkEffect({ tool: "pr_diff", agent, issueState: "QA", runActive: true })).toEqual(
      FORBIDDEN,
    );
    expect(
      checkEffect({ tool: "git_push", agent, issueState: "InProgress", runActive: true }),
    ).toEqual(FORBIDDEN);
    expect(
      checkEffect({ tool: "issue_comment", agent, issueState: "InReview", runActive: true }),
    ).toEqual(FORBIDDEN);
    expect(checkEffect({ tool: "git_push", agent, issueState: "QA", runActive: false })).toEqual({
      status: 404,
      message: "A run não está ativa.",
    });
    expect(checkEffect({ tool: "pr_diff", agent, issueState: "QA", runActive: false })).toEqual(
      FORBIDDEN,
    );
  });
});
