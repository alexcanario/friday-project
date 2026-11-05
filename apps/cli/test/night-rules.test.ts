import { describe, expect, it } from "vitest";
import { readText } from "./helpers.ts";

describe("night rules", () => {
  it("reads the risk of the issue before choosing the judge", () => {
    const lines = readText("docs/night.md").split("\n");
    const judge = lines.findIndex((l) => l.startsWith("   3. Judge:"));
    const decide = lines.findIndex((l) => l.startsWith("   4. Decidir"));
    expect(judge).toBeGreaterThan(-1);
    expect(judge).toBeLessThan(decide);
    for (const part of [
      "`- risco:`",
      "`judge-strong`",
      "se a linha faltar",
      "no mesmo `head_sha`",
    ]) {
      expect(lines[judge], part).toContain(part);
    }
    expect(readText("docs/night.md")).not.toMatch(/judge-strong. se houver gate ou risco/);
  });

  it("keeps the docs and agents on the same rule", () => {
    expect(readText("docs/process.md")).toContain("risco ≥ medium ou risco não declarado");
    for (const agent of ["judge", "judge-strong"]) {
      expect(readText(`.claude/agents/${agent}.md`).split("\n")[2]).toContain("no declared risk");
    }
  });
});
