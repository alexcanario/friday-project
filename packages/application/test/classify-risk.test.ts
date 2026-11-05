import type { FactoryConfig } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { classifyRisk, type PrDiff } from "../src/index.ts";

type Config = FactoryConfig["risk"];
const ALL: Config["rules"] = [
  "migrations",
  "infra",
  "ci",
  "dependencies",
  "secrets",
  "agent_config",
  "size",
];
const cfg = (rules: Config["rules"]): Config => ({
  rules,
  max_changed_lines: 2000,
  max_changed_files: 50,
});
const diff = (paths: string[], changedLines = 1, diffBytes = 100): PrDiff => ({
  files: paths.map((path) => ({ path, changedLines, hasPatch: true })),
  diffBytes,
});

describe("classifyRisk", () => {
  it("ci paths are high", () => {
    for (const p of [
      ".github/workflows/ci.yml",
      ".gitlab-ci.yml",
      ".circleci/config.yml",
      "ops/Jenkinsfile",
    ]) {
      expect(classifyRisk(diff([p]), cfg(["ci"]))).toEqual({ risk: "high", rules: ["ci"] });
    }
  });

  it("migration paths are high", () => {
    for (const p of [
      "src/migrations/001.sql",
      "db/migrate/2.rb",
      "alembic/env.py",
      "app/schema.rb",
    ]) {
      expect(classifyRisk(diff([p]), cfg(["migrations"]))).toEqual({
        risk: "high",
        rules: ["migrations"],
      });
    }
  });

  it("no match is unclassified, never low", () => {
    expect(classifyRisk(diff(["src/a.ts"]), cfg(ALL))).toEqual({ risk: "unclassified", rules: [] });
    expect(classifyRisk(diff([]), cfg(ALL))).toEqual({ risk: "unclassified", rules: [] });
  });

  it("a rule outside config.rules does not match", () => {
    expect(classifyRisk(diff([".github/workflows/ci.yml"]), cfg(["migrations"]))).toEqual({
      risk: "unclassified",
      rules: [],
    });
  });

  it("lists matched rules in fixed order", () => {
    const a = diff([".github/workflows/ci.yml", "src/migrations/001.sql"]);
    const b = diff(["src/migrations/001.sql", ".github/workflows/ci.yml"]);
    for (const d of [a, b]) {
      expect(classifyRisk(d, cfg(["ci", "migrations"])).rules).toEqual(["migrations", "ci"]);
    }
  });

  it("size rule thresholds and missing patch", () => {
    const c = cfg(["size"]);
    expect(classifyRisk(diff(["a.ts"], 2001), c)).toEqual({ risk: "high", rules: ["size"] });
    expect(classifyRisk(diff(["a.ts"], 2000), c).risk).toBe("unclassified");
    const many = (n: number) => diff(Array.from({ length: n }, (_, i) => `f${i}.ts`));
    expect(classifyRisk(many(51), c).risk).toBe("high");
    expect(classifyRisk(many(50), c).risk).toBe("unclassified");
    const noPatch: PrDiff = {
      files: [{ path: "a.png", changedLines: 0, hasPatch: false }],
      diffBytes: 10,
    };
    expect(classifyRisk(noPatch, c).risk).toBe("high");
  });

  it("diff over the byte limit is high even with size off", () => {
    expect(classifyRisk(diff(["a.ts"], 1, 102401), cfg([]))).toEqual({
      risk: "high",
      rules: ["size"],
    });
    expect(classifyRisk(diff(["a.ts"], 1, 102400), cfg([])).risk).toBe("unclassified");
    expect(classifyRisk(diff(["a.ts"], 5000), cfg([])).risk).toBe("unclassified");
  });

  it("agent_config and dependencies paths are high, empty rules never match", () => {
    for (const p of [".claude/agents/judge.md", "CLAUDE.md", "a/AGENTS.md", ".friday/x.yaml"]) {
      expect(classifyRisk(diff([p]), cfg(["agent_config"]))).toEqual({
        risk: "high",
        rules: ["agent_config"],
      });
    }
    for (const p of ["packages/a/package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
      expect(classifyRisk(diff([p]), cfg(["dependencies"]))).toEqual({
        risk: "high",
        rules: ["dependencies"],
      });
    }
    expect(classifyRisk(diff(["Dockerfile", ".env"]), cfg(["infra", "secrets"]))).toEqual({
      risk: "unclassified",
      rules: [],
    });
  });
});
