import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./helpers.ts";

function run(...args: string[]) {
  const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ANTHROPIC_API_KEY: "", GITHUB_TOKEN: "" },
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

describe("friday eval --run routing", () => {
  it("routes eval --run and keeps rejecting --output without it", () => {
    expect(run("eval", "--run", "outro", "--output", "x.json")).toEqual({
      stdout: "",
      stderr: "Erro: valor inválido para --run: outro\n",
      code: 2,
    });
    expect(run("eval", "--output", "x.json")).toEqual({
      stdout: "",
      stderr: "Erro: flag desconhecida: --output\n",
      code: 2,
    });
    expect(existsSync(join(root, "x.json"))).toBe(false);
  }, 60_000);
});
