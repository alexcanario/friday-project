import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const eslint = new ESLint({ cwd: root });

async function restrictedErrors(file: string, pkg: string): Promise<number> {
  const code = `import "${pkg}";\n`;
  const [result] = await eslint.lintText(code, { filePath: `${root}/${file}` });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports").length;
}

const blocked: Array<[string, string]> = [
  ["apps/daemon/src/x.ts", "@friday/api"],
  ["apps/cli/src/x.ts", "@friday/api"],
  ["apps/api/src/x.ts", "@friday/daemon"],
  ["apps/api/src/x.ts", "@friday/cli"],
  ["packages/domain/src/x.ts", "@friday/api"],
  ["packages/application/src/x.ts", "@friday/api"],
  ["packages/infrastructure/src/x.ts", "@friday/api"],
];

describe("api layers", () => {
  it("blocks daemon, cli, domain, application and infrastructure importing api and api importing daemon or cli, and allows api importing application and infrastructure", async () => {
    for (const [file, pkg] of blocked) {
      expect(await restrictedErrors(file, pkg), `${file} -> ${pkg}`).toBe(1);
    }
    for (const pkg of ["@friday/application", "@friday/infrastructure"]) {
      expect(await restrictedErrors("apps/api/src/x.ts", pkg), pkg).toBe(0);
    }
  });
});
