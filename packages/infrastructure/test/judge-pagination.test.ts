import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const judgePath = resolve(import.meta.dirname, "../../../.claude/agents/judge.md");

describe("judge.md pagination", () => {
  it("judge.md never uses gh api --paginate", () => {
    expect(readFileSync(judgePath, "utf8")).not.toContain("--paginate");
  });
});
