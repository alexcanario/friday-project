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
];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/tmp-tsc-*/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/domain/**/*.ts"],
    rules: restrict(
      [...outer, "zod", ...nodeBuiltins],
      [
        ...outer.flatMap(pkg),
        ...pkg("zod"),
        rel("application"),
        rel("infrastructure"),
        rel("apps"),
      ].filter((p) => p.includes("/") || p.includes("*")),
    ),
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    rules: restrict(
      [
        "@friday/domain",
        "@friday/application",
        "@friday/infrastructure",
        "@friday/daemon",
        "@friday/cli",
      ],
      [
        ...["@friday/domain", "@friday/application", "@friday/infrastructure"].map((n) => `${n}/*`),
        "@friday/daemon/*",
        "@friday/cli/*",
        rel("domain"),
        rel("application"),
        rel("infrastructure"),
        rel("apps"),
      ],
    ),
  },
  {
    files: ["packages/application/**/*.ts"],
    rules: restrict(
      ["@friday/infrastructure", "@friday/daemon", "@friday/cli"],
      [
        ...["@friday/infrastructure", "@friday/daemon", "@friday/cli"].map((n) => `${n}/*`),
        rel("infrastructure"),
        rel("apps"),
      ],
    ),
  },
  {
    files: ["packages/infrastructure/**/*.ts"],
    rules: restrict(
      ["@friday/daemon", "@friday/cli"],
      ["@friday/daemon/*", "@friday/cli/*", rel("apps")],
    ),
  },
  {
    files: ["apps/daemon/**/*.ts"],
    rules: restrict(["@friday/cli"], ["@friday/cli/*", "**/apps/cli/**"]),
  },
  {
    files: ["apps/cli/**/*.ts"],
    rules: restrict(["@friday/daemon"], ["@friday/daemon/*", "**/apps/daemon/**"]),
  },
);
