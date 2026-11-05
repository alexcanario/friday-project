import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("sdk dependency", () => {
  it("pins the sdk and keeps it out of application", () => {
    const pkg = JSON.parse(read("../package.json"));
    expect(pkg.dependencies["@anthropic-ai/claude-agent-sdk"]).toBe("0.3.318");
    expect(pkg.dependencies.zod).toBe("4.6.7");
    expect(JSON.stringify(pkg)).not.toContain("@modelcontextprotocol/sdk");
    expect(JSON.stringify(pkg)).not.toContain('"@anthropic-ai/sdk"');
    const app = JSON.parse(read("../../application/package.json"));
    expect(JSON.stringify(app)).not.toContain("claude-agent-sdk");
    for (const file of ["agent-runtime", "held-reason-for", "fake-agent-runtime"]) {
      const src = read(`../../application/src/${file}.ts`);
      expect(src).not.toMatch(/from "(node:|fs|child_process|yaml|@anthropic-ai\/claude-agent-sdk)/);
    }
  });
});
