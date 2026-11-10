import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = new URL("../../../docs/token-do-autor.md", import.meta.url);

describe("author token doc", () => {
  it("author token doc names the token types and the reason", () => {
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    for (const term of [
      "fine-grained",
      "GitHub App",
      "token clássico",
      "escopo `repo`",
      "check-runs",
      "D89",
      "## Siglas",
    ]) {
      expect(text, term).toContain(term);
    }
  });
});
