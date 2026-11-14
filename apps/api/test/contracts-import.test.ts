import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as schemas from "../src/schemas.ts";

const MOVED = [
  "healthResponse",
  "issueItem",
  "transitionItem",
  "runItem",
  "daySum",
  "errorResponse",
  "approvalItem",
];

describe("api schemas", () => {
  it("moves response schemas to contracts and keeps request schemas", () => {
    const names = Object.keys(schemas);
    for (const name of MOVED) expect(names, name).not.toContain(name);
    expect(names.sort()).toEqual(["dayParams", "issueParams", "projectQuery", "runParams"]);

    const dir = join(import.meta.dirname, "../src/routes");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/schemas\.ts"/g)]
        .flatMap((m) => (m[1] ?? "").split(","))
        .map((s) => s.trim());
      for (const name of MOVED) expect(imports, `${file} -> ${name}`).not.toContain(name);
    }
  });
});
