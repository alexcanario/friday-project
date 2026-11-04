import { describe, expect, it } from "vitest";
import { check, resolveConfig } from "prettier";
import { root } from "./helpers.ts";
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
});
