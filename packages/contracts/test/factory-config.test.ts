/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { factoryConfigSchema } from "../src/index.ts";

type Json = { [key: string]: any };

function valid(): Json {
  return {
    schemaVersion: "friday/v1",
    enabled: true,
    repository: { owner: "alexcanario", name: "friday-sandbox", base: "main" },
    verify: { command: "pnpm -r test", timeout_s: 900 },
    flow: {
      screen_paths: ["**/*.razor"],
      pr_evidence: true,
      triage: { model: "haiku", max_budget_usd: 0.5 },
    },
    risk: {
      rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
      max_changed_lines: 2000,
      max_changed_files: 50,
    },
    pull_requests: { merge: "manual" },
    limits: { per_issue_usd: 5, per_day_usd: 10, approval_expires_min: 30 },
    secrets: ["ANTHROPIC_API_KEY"],
  };
}

function paths(obj: unknown, prefix: string[] = []): string[][] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj).flatMap(([k, v]) => [[...prefix, k], ...paths(v, [...prefix, k])]);
}

function without(path: string[]): Json {
  const copy = valid();
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key];
  delete node[path[path.length - 1] as string];
  return copy;
}

function withValue(path: string[], value: unknown): Json {
  const copy = valid();
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key];
  node[path[path.length - 1] as string] = value;
  return copy;
}

describe("factoryConfigSchema", () => {
  it("accepts the factory config and rejects each invalid key", () => {
    expect(factoryConfigSchema.safeParse(valid()).success).toBe(true);

    for (const path of paths(valid())) {
      expect(factoryConfigSchema.safeParse(without(path)).success, path.join(".")).toBe(false);
    }

    const invalid: Array<[string[], unknown]> = [
      [["schemaVersion"], "fhp/v1"],
      [["pull_requests", "merge"], "always"],
      [["risk", "max_changed_lines"], 0],
      [["limits", "per_day_usd"], 0],
      [["flow", "triage", "max_budget_usd"], 0],
      [
        ["risk", "rules"],
        ["ci", "ci"],
      ],
      [["risk", "rules"], ["other"]],
      [["flow", "max_qa_rounds"], 3],
      [["flow", "implement"], "x"],
      [["flow", "triage", "x"], 1],
      [["limits", "x"], 1],
      [["risk", "x"], 1],
      [["repository", "x"], 1],
      [["verify", "x"], 1],
      [["pull_requests", "x"], 1],
      [["x"], 1],
      [["repository", "name"], "  "],
      [["verify", "command"], ""],
      [["verify", "timeout_s"], 1.5],
      [["limits", "approval_expires_min"], 0],
      [["flow", "triage", "model"], "gpt"],
      [["secrets"], ["lower"]],
      [["secrets"], ["A=1"]],
    ];
    for (const [path, value] of invalid) {
      expect(factoryConfigSchema.safeParse(withValue(path, value)).success, path.join(".")).toBe(
        false,
      );
    }
  });

  it("accepts max_concurrent_runs as an optional positive integer", () => {
    expect(factoryConfigSchema.safeParse(valid()).success).toBe(true);
    const withLimit = (v: unknown): Json => {
      const c = valid();
      c["limits"]["max_concurrent_runs"] = v;
      return c;
    };
    expect(factoryConfigSchema.safeParse(withLimit(2)).success).toBe(true);
    for (const bad of [0, -1, 1.5]) {
      expect(factoryConfigSchema.safeParse(withLimit(bad)).success, String(bad)).toBe(false);
    }
  });
});

describe("pull_requests.author_token_env", () => {
  it("accepts and rejects pull_requests.author_token_env", () => {
    const withEnv = (v: unknown) => ({
      ...valid(),
      pull_requests: { merge: "manual", ...(v === undefined ? {} : { author_token_env: v }) },
    });
    expect(factoryConfigSchema.safeParse(withEnv("FRIDAY_AUTHOR_TOKEN")).success).toBe(true);
    expect(factoryConfigSchema.safeParse(withEnv(undefined)).success).toBe(true);
    for (const bad of ["lower", "", "A-B"]) {
      expect(factoryConfigSchema.safeParse(withEnv(bad)).success).toBe(false);
    }
  });
});

describe("pull_requests.review_token_env", () => {
  const withPr = (pr: unknown) => ({ ...valid(), pull_requests: pr });
  it("accepts pull_requests.review_token_env", () => {
    const ok = [
      { merge: "manual", review_token_env: "FRIDAY_JUDGE_TOKEN" },
      { merge: "auto", review_token_env: "A1_B2" },
      { merge: "manual" },
    ];
    for (const pr of ok) expect(factoryConfigSchema.safeParse(withPr(pr)).success).toBe(true);
    const both = { ...withPr({ merge: "manual", review_token_env: "FRIDAY_JUDGE_TOKEN" }) };
    expect(factoryConfigSchema.safeParse({ ...both, secrets: ["ANTHROPIC_API_KEY"] }).success).toBe(
      true,
    );
  });
  it("rejects an invalid or unknown pull_requests key", () => {
    for (const bad of ["lower", "", "A-B", "1ABC", "_ABC", 5]) {
      const pr = { merge: "manual", review_token_env: bad };
      expect(factoryConfigSchema.safeParse(withPr(pr)).success, String(bad)).toBe(false);
    }
    const unknown = { merge: "manual", review_token: "X" };
    expect(factoryConfigSchema.safeParse(withPr(unknown)).success).toBe(false);
  });
});

describe("factoryConfigSchema repository and token rules", () => {
  const withRepo = (field: "owner" | "name", value: string) => {
    const cfg = valid();
    cfg["repository"][field] = value;
    return cfg;
  };
  const withPr = (pr: unknown) => ({ ...valid(), pull_requests: pr });

  it("validates the GitHub name format of owner and name", () => {
    for (const field of ["owner", "name"] as const) {
      for (const ok of ["alexcanario", "friday-sandbox", "a.b_c-1"]) {
        expect(factoryConfigSchema.safeParse(withRepo(field, ok)).success, `${field} ${ok}`).toBe(
          true,
        );
      }
      for (const bad of [".", "..", "a/b", "a b", "a\\b", "x\ny"]) {
        const result = factoryConfigSchema.safeParse(withRepo(field, bad));
        expect(result.success, `${field} ${JSON.stringify(bad)}`).toBe(false);
      }
    }
  });

  it("rejects equal author_token_env and review_token_env", () => {
    const same = {
      merge: "manual",
      author_token_env: "FRIDAY_TOKEN",
      review_token_env: "FRIDAY_TOKEN",
    };
    const result = factoryConfigSchema.safeParse(withPr(same));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["pull_requests", "review_token_env"]);
    const ok = [
      {
        merge: "manual",
        author_token_env: "FRIDAY_AUTHOR_TOKEN",
        review_token_env: "FRIDAY_JUDGE_TOKEN",
      },
      { merge: "manual", author_token_env: "FRIDAY_TOKEN" },
      { merge: "manual", review_token_env: "FRIDAY_TOKEN" },
      { merge: "manual" },
    ];
    for (const pr of ok) expect(factoryConfigSchema.safeParse(withPr(pr)).success).toBe(true);
  });
});
