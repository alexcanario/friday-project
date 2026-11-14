import { describe, expect, it } from "vitest";
import { factoryConfigSchema } from "../src/index.ts";

function base(): Record<string, unknown> {
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
    pull_requests: {
      merge: "manual",
      author_token_env: "FRIDAY_TOKEN",
      review_token_env: "FRIDAY_JUDGE_TOKEN",
    },
    limits: { per_issue_usd: 5, per_day_usd: 10, approval_expires_min: 30 },
    secrets: ["ANTHROPIC_API_KEY"],
  };
}

const withPanel = (panel: unknown) => factoryConfigSchema.safeParse({ ...base(), panel });

describe("factory config panel", () => {
  it("accepts absent panel and valid ports, rejects invalid ports and unknown panel keys", () => {
    expect(factoryConfigSchema.safeParse(base()).success).toBe(true);
    expect(withPanel({ port: 7777 }).success).toBe(true);
    expect(withPanel({ port: 65535 }).success).toBe(true);
    for (const port of [0, 70000, "x", 1.5]) {
      expect(withPanel({ port }).success, String(port)).toBe(false);
    }
    expect(withPanel({ port: 7777, host: "0.0.0.0" }).success).toBe(false);
  });
});
