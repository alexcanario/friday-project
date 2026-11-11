import { describe, expect, it } from "vitest";
import { makeRoot, problemsOf, removeLine, replaceLine, edit } from "./config-helpers.ts";

const F = "factory.yaml";
const QA = "agents/qa.yaml";

const summary = (root: string) => problemsOf(root).map((p) => [p.file, p.code, p.line]);

describe("secret values", () => {
  it("rejects secrets with values", () => {
    let root = makeRoot();
    replaceLine(root, F, 30, "  - ANTHROPIC_API_KEY=abc");
    expect(summary(root)).toEqual([[F, "secret_value", 30]]);

    root = makeRoot();
    replaceLine(root, F, 30, "  - KEY: abc");
    expect(summary(root)).toEqual([[F, "secret_value", 30]]);

    root = makeRoot();
    replaceLine(root, F, 29, "secrets: A=1");
    removeLine(root, F, 30);
    expect(summary(root)).toEqual([[F, "secret_value", 29]]);

    root = makeRoot();
    replaceLine(root, F, 29, "secrets:");
    replaceLine(root, F, 30, "  KEY: abc");
    expect(summary(root)).toEqual([[F, "secret_value", 30]]);

    root = makeRoot();
    replaceLine(root, F, 29, "secrets:");
    replaceLine(root, F, 30, "");
    expect(summary(root).map((s) => s[1])).toEqual(["invalid_value"]);

    for (const prefix of ["sk-ant-", "ghp_", "gho_", "ghs_", "github_pat_"]) {
      root = makeRoot();
      replaceLine(root, F, 8, `  command: ${prefix}x1`);
      expect(summary(root), prefix).toEqual([[F, "secret_value", 8]]);
    }

    root = makeRoot();
    replaceLine(root, QA, 7, "tools:\n  - Read\n  - ghp_x1");
    expect(summary(root).map((s) => s[1])).toEqual(["secret_value"]);

    root = makeRoot();
    edit(root, F, (l) => [...l.slice(0, 30), "foo: ghp_x1", ""]);
    expect(summary(root)).toEqual([
      [F, "secret_value", 31],
      [F, "unknown_key", 31],
    ]);

    root = makeRoot();
    edit(root, F, (l) => ["# ghp_x1", ...l]);
    expect(summary(root)).toEqual([[F, "secret_value", 1]]);

    root = makeRoot();
    edit(root, QA, (l) => [...l.slice(0, 11), "a: |", "  one", "  ghp_x1", ""]);
    expect(summary(root)).toContainEqual([QA, "secret_value", 14]);

    expect(problemsOf(makeRoot())).toEqual([]);
  });

  it("never repeats a secret value", () => {
    const roots: string[] = [];
    let root = makeRoot();
    edit(root, F, () => ["a: 1", "b: [ghp_x1", "c: 2", ""]);
    expect(summary(root)).toEqual([
      [F, "secret_value", 2],
      [F, "yaml_invalid", 3],
    ]);
    roots.push(root);

    root = makeRoot();
    edit(root, F, (l) => ["ghp_x1: 1", ...l]);
    expect(summary(root).map((s) => s[1])).toEqual(["secret_value", "unknown_key"]);
    roots.push(root);

    root = makeRoot();
    edit(root, F, (l) => [...l.slice(0, 30), "foo: ghp_x1", ""]);
    roots.push(root);

    for (const r of roots) {
      for (const p of problemsOf(r)) expect(p.message).not.toContain("ghp_x1");
    }
  });
});
