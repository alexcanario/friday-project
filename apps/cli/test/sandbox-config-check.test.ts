import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";
import { root } from "./helpers.ts";

function run(...args: string[]) {
  const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

describe("sandbox registry config check", () => {
  it("prints 0 problemas and exits 0 for the registry", () => {
    expect(run("config", "check", "--root", "registry")).toEqual({
      stdout: "0 problemas\n",
      stderr: "",
      code: 0,
    });
  });

  it("exits 1 when factory.yaml has no limits", () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-sandbox-"));
    cpSync(join(root, "registry"), dir, { recursive: true });
    const file = join(dir, "factory.yaml");
    const text = readFileSync(file, "utf8");
    const without = text.replace(/^limits:\n(?: {2}.*\n)+/m, "");
    expect(without).not.toBe(text);
    writeFileSync(file, without);
    const r = run("config", "check", "--root", dir);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("factory.yaml");
    expect(r.stdout.endsWith("\n")).toBe(true);
    const lines = r.stdout.split("\n").filter((l) => l !== "");
    expect(lines[lines.length - 1]).toBe("1 problema");
    expect(r.stdout).not.toContain("0 problemas");
  });

  it("sandbox registry files are prettier-formatted", async () => {
    const config = await resolveConfig(join(root, "x.json"), {
      config: join(root, ".prettierrc.json"),
    });
    const yaml = readFileSync(join(root, "registry/factory.yaml"), "utf8");
    const json = readFileSync(join(root, "registry/sandbox/seed-issues.json"), "utf8");
    expect(await check(yaml, { ...config, parser: "yaml" })).toBe(true);
    expect(await check(json, { ...config, parser: "json" })).toBe(true);
    const minified = JSON.stringify(JSON.parse(json));
    expect(await check(minified, { ...config, parser: "json" })).toBe(false);
  });
});
