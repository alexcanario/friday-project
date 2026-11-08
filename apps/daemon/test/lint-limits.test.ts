import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, "eslint.config.js") });

async function rules(code: string, filePath: string): Promise<(string | null)[]> {
  const results = await eslint.lintText(code, { filePath });
  return results[0]!.messages.map((m) => m.ruleId);
}

function fn(codeLines: number, extra = ""): string {
  const body = Array.from({ length: codeLines - 2 }, (_, i) => `  void ${i};`).join("\n");
  return `export function f() {\n${extra}${body}\n}\n`;
}

function file(codeLines: number): string {
  return (
    Array.from({ length: codeLines }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n"
  );
}

describe("lint limits", () => {
  it("rejects a function of 51 code lines in src", async () => {
    expect(await rules(fn(51), "apps/daemon/src/virtual.ts")).toContain("max-lines-per-function");
  });

  it("accepts a function of 50 code lines in src", async () => {
    expect(await rules(fn(50), "apps/daemon/src/virtual.ts")).not.toContain(
      "max-lines-per-function",
    );
  });

  it("ignores blank lines and comments when counting function lines", async () => {
    const extra = "\n".repeat(20) + "  // c\n".repeat(20);
    expect(await rules(fn(50, extra), "apps/daemon/src/virtual.ts")).not.toContain(
      "max-lines-per-function",
    );
  });

  it("rejects a file of 301 code lines and accepts one of 300", async () => {
    const path = "packages/domain/src/virtual.ts";
    expect(await rules(file(301), path)).toContain("max-lines");
    expect(await rules(file(300), path)).not.toContain("max-lines");
  });

  it("applies the limit to every apps and packages src folder", async () => {
    for (const p of ["packages/infrastructure/src/virtual.ts", "apps/api/src/virtual.ts"]) {
      expect(await rules(fn(51), p)).toContain("max-lines-per-function");
    }
  });
});
