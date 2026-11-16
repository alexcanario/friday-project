import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.ts";

const apiKey = "sk-" + "ant-abc123_x";

describe("redact", () => {
  it("redacts JSON and non-hex token values", () => {
    expect(redact('{"GITHUB_TOKEN":"ghp_abc123"}')).toBe('{"GITHUB_TOKEN":"[TOKEN-REDACTED]"}');
    expect(redact("GH_TOKEN=ghp_abc")).toBe("GH_TOKEN=[TOKEN-REDACTED]");
    expect(redact("FRIDAY_CANARY_TOKEN=CANARY-env-ab12cd34")).toBe("FRIDAY_CANARY_TOKEN=[TOKEN-REDACTED]");
    expect(redact('\\"X_TOKEN\\":\\"abc\\"')).toBe('\\"X_TOKEN\\":\\"[TOKEN-REDACTED]\\"');
  });

  it("keeps redacting the API key and hex tokens and leaves other text alone", () => {
    expect(redact(apiKey)).toBe("[API-KEY-REDACTED]");
    expect(redact(`API_TOKEN=${"ab12".repeat(4)}`)).toBe("API_TOKEN=[TOKEN-REDACTED]");
    for (const text of ["NODE_ENV=production", "TOKENIZER=abc", '{"name":"x"}']) expect(redact(text)).toBe(text);
  });

  it("run-agent redacts what it saves and judges the raw lines", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../run-agent.ts"), "utf8");
    expect(source).toContain('import { redact } from "./src/redact.ts"');
    const saving = source.split("\n").filter((line) => line.includes("agent-docker.messages.jsonl"));
    expect(saving.length).toBeGreaterThan(0);
    for (const line of saving) expect(line).toContain("redact(");
    expect(source).toContain('printVerdict("docker", lines)');
    expect(source).not.toContain("function redact(");
  });
});
