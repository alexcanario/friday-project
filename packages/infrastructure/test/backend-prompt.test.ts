import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../registry");
const prompt = readFileSync(resolve(root, "prompts/backend.md"), "utf8");
const agent = readFileSync(resolve(root, "agents/backend.yaml"), "utf8");

describe("backend prompt", () => {
  it("describes the git_push message flow", () => {
    expect(prompt).toContain("git_push { branch, message }");
    expect(prompt).toContain("headSha");
    expect(prompt).toContain("200: push feito:");
    expect(prompt).not.toMatch(/git add|git commit/);
    expect(agent).not.toMatch(/git add|git commit/);
  });
});

describe("backend prompt rework", () => {
  it("backend prompt tells the specialist to push again on rework", () => {
    expect(prompt).toContain(
      "On a rework round, call git_push again before work_report and copy the SHA it returns into headSha; the orchestrator also fills headSha from the last push.",
    );
  });
});
