import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { readJson, requiredPackages, root } from "./helpers.ts";

const eslint = new ESLint({ cwd: root });

async function lint(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: `${root}/${file}` });
  return result?.messages ?? [];
}

const rejected: Array<[string, string[]]> = [
  [
    "packages/domain/src/x.ts",
    [
      "@friday/contracts",
      "@friday/application",
      "@friday/infrastructure",
      "@friday/daemon",
      "@friday/cli",
      "zod",
      "better-sqlite3",
      "drizzle-orm",
      "drizzle-orm/sqlite-core",
      "node:fs",
      "fs",
      "node:child_process",
      "node:net",
      "../../application/src/index.ts",
    ],
  ],
  [
    "packages/application/src/x.ts",
    [
      "@friday/infrastructure",
      "@friday/daemon",
      "@friday/cli",
      "../../infrastructure/src/index.ts",
    ],
  ],
  [
    "packages/infrastructure/src/x.ts",
    ["@friday/daemon", "@friday/cli", "../../../apps/cli/src/index.ts"],
  ],
  ["apps/daemon/src/x.ts", ["@friday/cli"]],
  ["apps/cli/src/x.ts", ["@friday/api/src/listen.ts", "../../../apps/api/src/index.ts"]],
];

const accepted: Array<[string, string[]]> = [
  ["packages/domain/src/x.ts", ["./y.ts", "./sub/z.ts"]],
  ["packages/application/src/x.ts", ["@friday/domain"]],
  ["packages/infrastructure/src/x.ts", ["@friday/domain", "@friday/application"]],
  ["apps/daemon/src/x.ts", ["@friday/domain", "@friday/application", "@friday/infrastructure"]],
  [
    "apps/cli/src/x.ts",
    [
      "@friday/domain",
      "@friday/application",
      "@friday/infrastructure",
      "@friday/daemon",
      "@friday/api",
    ],
  ],
];

describe("layer boundaries", () => {
  it("rejects imports that point outward", async () => {
    for (const [file, modules] of rejected) {
      for (const mod of modules) {
        const messages = await lint(file, `import ${JSON.stringify(mod)};\n`);
        const ids = messages.map((m) => m.ruleId);
        expect(ids, `${file} -> ${mod}`).toContain("no-restricted-imports");
      }
    }
  });

  it("accepts imports that point inward", async () => {
    for (const [file, modules] of accepted) {
      for (const mod of modules) {
        const messages = await lint(file, `import type {} from ${JSON.stringify(mod)};\n`);
        const errors = messages.filter((m) => m.severity === 2);
        expect(errors, `${file} -> ${mod}`).toEqual([]);
      }
    }
  });

  it("declares the allowed workspace dependencies and no outward edge", () => {
    const rank: Record<string, number> = {
      "@friday/domain": 0,
      "@friday/application": 1,
      "@friday/infrastructure": 2,
      "@friday/daemon": 3,
      "@friday/cli": 4,
    };
    const required: Record<string, string[]> = {
      "@friday/domain": [],
      "@friday/application": ["@friday/domain"],
      "@friday/infrastructure": ["@friday/domain", "@friday/application"],
      "@friday/daemon": ["@friday/domain", "@friday/application", "@friday/infrastructure"],
      "@friday/cli": [
        "@friday/domain",
        "@friday/application",
        "@friday/infrastructure",
        "@friday/daemon",
        "@friday/api",
      ],
    };
    for (const [name, dir] of Object.entries(requiredPackages)) {
      const deps = Object.keys(readJson(`${dir}/package.json`).dependencies ?? {}).filter((d) =>
        d.startsWith("@friday/"),
      );
      for (const dep of required[name] ?? []) expect(deps).toContain(dep);
      for (const dep of deps) {
        const r = rank[dep];
        if (r === undefined) continue;
        expect(r, `${name} -> ${dep}`).toBeLessThan(rank[name] as number);
      }
      if (name === "@friday/domain") expect(deps).toEqual([]);
    }
  });
});
