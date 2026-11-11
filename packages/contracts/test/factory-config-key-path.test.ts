import { describe, expect, it } from "vitest";
import { factoryConfigSchema } from "../src/index.ts";

const BLOCKS = ["author_app", "review_app"] as const;
type Block = (typeof BLOCKS)[number];

function config(block: Block, privateKeyPath: string) {
  const app = (app_id: number, path: string) => ({
    app_id,
    installation_id: 2,
    private_key_path: path,
  });
  const ok = "/etc/friday/other.pem";
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
      author_app: app(1, block === "author_app" ? privateKeyPath : ok),
      review_app: app(3, block === "review_app" ? privateKeyPath : ok),
    },
    limits: { per_issue_usd: 5, per_day_usd: 10, approval_expires_min: 30 },
    secrets: ["ANTHROPIC_API_KEY"],
  };
}

describe("private_key_path", () => {
  it("accepts POSIX and Windows absolute private_key_path", () => {
    const paths = [
      "/etc/friday/author.pem",
      String.raw`C:\Users\alex\.friday\keys\author.pem`,
      "C:/Users/alex/.friday/keys/author.pem",
    ];
    for (const block of BLOCKS) {
      for (const path of paths) {
        const result = factoryConfigSchema.safeParse(config(block, path));
        expect(result.success, `${block} ${path}`).toBe(true);
      }
    }
  });

  it("rejects relative, drive-relative and UNC private_key_path", () => {
    const paths = [
      "",
      "keys/author.pem",
      "./author.pem",
      String.raw`keys\author.pem`,
      String.raw`.\author.pem`,
      "C:author.pem",
      "C:",
      String.raw`\\servidor\pasta\author.pem`,
      String.raw`\pasta\author.pem`,
      "//servidor/pasta/author.pem",
      String.raw`/\servidor\pasta\author.pem`,
    ];
    for (const block of BLOCKS) {
      for (const path of paths) {
        const result = factoryConfigSchema.safeParse(config(block, path));
        expect(result.success, `${block} ${path}`).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.path).toEqual([
            "pull_requests",
            block,
            "private_key_path",
          ]);
        }
      }
    }
  });
});
