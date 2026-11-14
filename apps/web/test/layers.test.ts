import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const eslint = new ESLint({ cwd: root });

async function restrictedErrors(file: string, pkg: string): Promise<number> {
  const [result] = await eslint.lintText(`import "${pkg}";\n`, { filePath: `${root}/${file}` });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports").length;
}

const blocked = [
  "@friday/domain",
  "@friday/application",
  "@friday/infrastructure",
  "@friday/daemon",
  "@friday/cli",
  "@friday/api",
];

describe("web layers", () => {
  it("allows contracts and blocks every other layer package in ts and tsx", async () => {
    for (const ext of ["ts", "tsx"]) {
      const file = `apps/web/src/x.${ext}`;
      expect(await restrictedErrors(file, "@friday/contracts"), `${file} contracts`).toBe(0);
      for (const pkg of blocked) {
        expect(await restrictedErrors(file, pkg), `${file} -> ${pkg}`).toBe(1);
      }
    }
  });
});
