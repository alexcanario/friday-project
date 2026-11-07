import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeBuiltins = [
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "child_process",
  "node:child_process",
  "net",
  "node:net",
  "http",
  "node:http",
  "https",
  "node:https",
  "os",
  "node:os",
];

const pkg = (name) => [name, `${name}/*`];
const rel = (layer) => `**/${layer}/**`;

function restrict(paths, patterns = []) {
  return {
    "no-restricted-imports": [
      "error",
      {
        paths: paths.map((name) => ({ name, message: "Importação proibida pelas camadas." })),
        patterns: patterns.map((group) => ({
          group: [group],
          message: "Importação proibida pelas camadas.",
        })),
      },
    ],
  };
}

const outer = [
  "@friday/contracts",
  "@friday/application",
  "@friday/infrastructure",
  "@friday/daemon",
  "@friday/cli",
  "@friday/api",
];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/tmp-tsc-*/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/domain/**/*.ts"],
    rules: restrict(
      [...outer, "zod", "better-sqlite3", "drizzle-orm", ...nodeBuiltins],
      [
        ...outer.flatMap(pkg),
        ...pkg("zod"),
        ...pkg("better-sqlite3"),
        ...pkg("drizzle-orm"),
        rel("application"),
        rel("infrastructure"),
        rel("apps"),
      ].filter((p) => p.endsWith("*")),
    ),
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!zod(?:/|$)|\\.{1,2}/).+",
              message: "O pacote contracts só pode importar zod e módulos relativos.",
            },
            {
              group: [rel("domain"), rel("application"), rel("infrastructure"), rel("apps")],
              message: "Importação proibida pelas camadas.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/application/**/*.ts"],
    rules: restrict(
      ["@friday/infrastructure", "@friday/daemon", "@friday/cli", "@friday/api"],
      [
        ...["@friday/infrastructure", "@friday/daemon", "@friday/cli", "@friday/api"].map(
          (n) => `${n}/*`,
        ),
        rel("infrastructure"),
        rel("apps"),
      ],
    ),
  },
  {
    files: ["packages/infrastructure/**/*.ts"],
    rules: restrict(
      ["@friday/daemon", "@friday/cli", "@friday/api"],
      ["@friday/daemon/*", "@friday/cli/*", "@friday/api/*", rel("apps")],
    ),
  },
  {
    files: ["apps/daemon/**/*.ts"],
    rules: restrict(
      ["@friday/cli", "@friday/api"],
      ["@friday/cli/*", "@friday/api/*", "**/apps/cli/**", "**/apps/api/**"],
    ),
  },
  {
    files: ["apps/cli/**/*.ts"],
    rules: restrict(
      ["@friday/daemon", "@friday/api"],
      ["@friday/daemon/*", "@friday/api/*", "**/apps/daemon/**", "**/apps/api/**"],
    ),
  },
  {
    files: ["apps/api/**/*.ts"],
    rules: restrict(
      ["@friday/daemon", "@friday/cli"],
      ["@friday/daemon/*", "@friday/cli/*", "**/apps/daemon/**", "**/apps/cli/**"],
    ),
  },
  {
    files: [
      "apps/daemon/test/breaker-dispatch.test.ts",
      "apps/daemon/test/breaker-end-to-end.test.ts",
      "apps/daemon/test/breaker-dispatch-helpers.ts",
    ],
    rules: { "max-lines": ["error", 300] },
  },
  {
    files: ["apps/daemon/test/breaker-dispatch-helpers.ts"],
    rules: { "max-lines-per-function": ["error", 50] },
  },
);
