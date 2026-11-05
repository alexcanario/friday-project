import { describe, expect, it } from "vitest";
import { matchesGlob } from "../src/index.ts";

describe("matchesGlob", () => {
  it("** matches zero or more directories", () => {
    expect(matchesGlob("**/Jenkinsfile", "Jenkinsfile")).toBe(true);
    expect(matchesGlob("**/Jenkinsfile", "a/b/Jenkinsfile")).toBe(true);
    expect(matchesGlob("**/Jenkinsfile", "Jenkinsfile.bak")).toBe(false);
  });

  it("is anchored, case-sensitive and * stops at slash", () => {
    expect(matchesGlob(".github/**", ".github/workflows/ci.yml")).toBe(true);
    expect(matchesGlob(".github/**", "x/.github/a.yml")).toBe(false);
    expect(matchesGlob("*.md", "a/b.md")).toBe(false);
    expect(matchesGlob("*.md", "b.md")).toBe(true);
    expect(matchesGlob("CLAUDE.md", "claude.md")).toBe(false);
  });
});
