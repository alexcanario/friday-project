import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const web = resolve(import.meta.dirname, "..");
const root = resolve(web, "../..");
const read = (p: string) => readFileSync(p, "utf8");
const pkg = JSON.parse(read(join(web, "package.json"))) as {
  name: string;
  private: boolean;
  type: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};
const rootPkg = JSON.parse(read(join(root, "package.json"))) as {
  devDependencies: Record<string, string>;
};

describe("web package", () => {
  it("pins the web dependencies and scripts", () => {
    expect(pkg.name).toBe("@friday/web");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    const d = pkg.dependencies;
    expect(d["react"]).toBe("19.3.1");
    expect(d["react-dom"]).toBe("19.3.1");
    expect(d["@tanstack/react-query"]).toBe("5.107.1");
    expect(d["@friday/contracts"]).toBe("workspace:*");
    const dev = pkg.devDependencies;
    expect(dev["vite"]).toBe("8.3.5");
    expect(dev["vite"]).toBe(rootPkg.devDependencies["vite"]);
    expect(dev["@vitejs/plugin-react"]).toBe("6.3.0");
    expect(dev["@types/react"]).toBe("19.3.0");
    expect(dev["@types/react-dom"]).toBe("19.3.0");
    for (const name of ["zod", "vitest", "typescript", "eslint", "prettier"]) {
      expect(d[name], name).toBeUndefined();
      expect(dev[name], name).toBeUndefined();
    }
    expect(pkg.scripts["typecheck"]).toBe("tsc --noEmit");
    expect(pkg.scripts["lint"]).toBe("eslint . && prettier --check .");
    expect(pkg.scripts["test"]).toBe("vitest run --passWithNoTests");
    expect(pkg.scripts["build"]).toBe("vite build");
    expect(pkg.scripts["dev"]).toBe("vite");
    expect(read(join(web, ".prettierignore")).trim()).toBe("dist/");
  });

  it("extends the base tsconfig with react-jsx and configures vitest typecheck", () => {
    const ts = JSON.parse(read(join(web, "tsconfig.json"))) as {
      extends: string;
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.extends).toBe("../../tsconfig.base.json");
    expect(ts.compilerOptions["jsx"]).toBe("react-jsx");
    expect(ts.compilerOptions["module"]).toBe("esnext");
    expect(ts.compilerOptions["moduleResolution"]).toBe("bundler");
    const vite = read(join(web, "vite.config.ts"));
    expect(vite).toContain('from "vitest/config"');
    expect(vite).toContain('include: ["test/**/*.test-d.ts"]');
  });
});
