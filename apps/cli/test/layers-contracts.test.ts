import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { root } from "./helpers.ts";

const eslint = new ESLint({ cwd: root });

async function ruleIds(file: string, mod: string) {
  const code = `import type {} from ${JSON.stringify(mod)};\n`;
  const [result] = await eslint.lintText(code, { filePath: `${root}/${file}` });
  return (result?.messages ?? []).map((m) => m.ruleId);
}

describe("contracts layer", () => {
  it("contracts may import only zod; application may import contracts; domain may not", async () => {
    const c = "packages/contracts/src/x.ts";
    for (const mod of [
      "@friday/domain",
      "@friday/application",
      "@friday/infrastructure",
      "@friday/daemon",
      "@friday/cli",
    ]) {
      expect(await ruleIds(c, mod), mod).toContain("no-restricted-imports");
    }
    expect(await ruleIds(c, "zod")).not.toContain("no-restricted-imports");
    for (const mod of [
      "node:fs",
      "fs",
      "node:child_process",
      "node:net",
      "node:path",
      "worker_threads",
      "fastify",
      "@scope/pkg",
      "fs/promises",
      "@x/pkg",
      "a/b",
    ]) {
      expect(await ruleIds(c, mod), mod).toContain("no-restricted-imports");
    }
    expect(await ruleIds(c, "./y.ts")).not.toContain("no-restricted-imports");
    expect(await ruleIds(c, "../z.ts")).not.toContain("no-restricted-imports");
    expect(await ruleIds("packages/application/src/x.ts", "@friday/contracts")).not.toContain(
      "no-restricted-imports",
    );
    expect(await ruleIds("packages/domain/src/x.ts", "@friday/contracts")).toContain(
      "no-restricted-imports",
    );
  });
});
