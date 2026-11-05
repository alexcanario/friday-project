import { describe, expect, it } from "vitest";
import { check, getFileInfo, resolveConfig } from "prettier";
import { readText, root } from "./helpers.ts";
import { join } from "node:path";

describe("prettier", () => {
  it("rejects unformatted code and accepts formatted code", async () => {
    const config = await resolveConfig(join(root, "x.ts"), {
      config: join(root, ".prettierrc.json"),
    });
    const opts = { ...config, parser: "typescript" };
    expect(await check("const a=1", opts)).toBe(false);
    expect(await check("const a = 1;\n", opts)).toBe(true);
  });

  it("anchors the contracts ignore at the root", async () => {
    const lines = readText(".prettierignore").split("\n");
    expect(lines).toContain("/contracts/");
    expect(lines).not.toContain("contracts/");
    const ignorePath = join(root, ".prettierignore");
    const src = await getFileInfo(join(root, "packages/contracts/src/index.ts"), { ignorePath });
    expect(src.ignored).toBe(false);
    const gen = await getFileInfo(join(root, "contracts/triage.schema.json"), { ignorePath });
    expect(gen.ignored).toBe(true);
  });
});
