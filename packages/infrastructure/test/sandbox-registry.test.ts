import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFactoryConfig } from "../src/index.ts";

describe("sandbox registry", () => {
  it("loads the sandbox registry with the fixed values", () => {
    const result = loadFactoryConfig(resolve(import.meta.dirname, "../../../registry"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { config } = result;
    expect(config.repository).toMatchObject({
      owner: "alexcanario",
      name: "friday-sandbox",
      base: "develop",
    });
    expect(config.verify).toMatchObject({ command: "dotnet test", timeout_s: 900 });
    expect(config.limits).toMatchObject({
      per_issue_usd: 10,
      per_day_usd: 30,
      approval_expires_min: 30,
    });
    expect(config.pull_requests.merge).toBe("manual");
    const pr = config.pull_requests;
    expect(Number("author_app" in pr) + Number(pr.author_token_env !== undefined)).toBe(1);
    expect(pr.author_token_env).toBe("FRIDAY_AUTHOR_TOKEN");
    expect(Number("review_app" in pr) + Number(pr.review_token_env !== undefined)).toBe(1);
    expect(pr.review_token_env).toBe("FRIDAY_REVIEW_TOKEN");
    expect(pr.review_token_env).not.toBe(pr.author_token_env);
    expect(config.flow.screen_paths).toEqual(["**/*.razor"]);
    expect(config.secrets).toContain("ANTHROPIC_API_KEY");
  });
});
