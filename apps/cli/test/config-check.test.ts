import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, readText, root } from "./helpers.ts";

const fixture = join(root, "packages/infrastructure/test/fixtures/valid");

function run(...args: string[]) {
  const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "friday-cli-"));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

describe("friday config check", () => {
  it("exits with 0, 1 and 2", () => {
    expect(run("config", "check", "--root", fixture)).toEqual({
      stdout: "0 problemas\n",
      stderr: "",
      code: 0,
    });

    const dir = copy();
    const file = join(dir, "factory.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("merge: manual", "merge: always"));
    expect(run("config", "check", "--root", dir)).toEqual({
      stdout:
        "factory.yaml:22: invalid_value: Valor inválido em pull_requests.merge.\n1 problema\n",
      stderr: "",
      code: 1,
    });

    const missing = run("config", "check", "--root", join(dir, "absent"));
    expect(missing.code).toBe(1);
    expect(missing.stderr).toBe("");
    expect(missing.stdout.split("\n")).toEqual([
      "agents:1: missing_file: Arquivo ausente.",
      "factory.yaml:1: missing_file: Arquivo ausente.",
      "2 problemas",
      "",
    ]);

    writeFileSync(file, readFileSync(file, "utf8") + "foo: ghp_x1\n");
    const secret = run("config", "check", "--root", dir);
    expect(secret.code).toBe(1);
    expect(secret.stdout).not.toContain("ghp_x1");
    expect(secret.stdout).toContain("secret_value");

    for (const args of [
      ["config", "check"],
      ["config", "check", "--root"],
      ["config", "other"],
    ]) {
      const r = run(...args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).not.toBe("");
    }
  }, 30_000);

  it("declares the friday binary", () => {
    expect(readJson("apps/cli/package.json").bin).toEqual({ friday: "./src/index.ts" });
    expect(readText("apps/cli/src/index.ts").split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  it("declares the dependencies and keeps the rules free of io", () => {
    const infra = readJson("packages/infrastructure/package.json").dependencies;
    expect(infra.yaml).toBe("2.9.1");
    expect(infra["@friday/contracts"]).toBe("workspace:*");
    expect(readJson("packages/application/package.json").dependencies["@friday/contracts"]).toBe(
      "workspace:*",
    );
    for (const f of ["roster-check", "agent-run-options", "config-problem"]) {
      const src = readText(`packages/application/src/${f}.ts`);
      expect(src, f).not.toMatch(/from\s+["'](node:[^"']*|fs|child_process|yaml)["']/);
    }
  });
});
