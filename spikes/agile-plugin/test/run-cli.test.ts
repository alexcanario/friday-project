import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const spikeDir = resolve(import.meta.dirname, "..");
const dir = () => mkdtempSync(join(tmpdir(), "plugin-cli-"));

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["run.ts", ...args], {
    cwd: spikeDir,
    env: { PATH: process.env.PATH ?? "", ...extraEnv },
    encoding: "utf8",
  });
}

describe("run.ts", () => {
  it("exits 2 without api key", () => {
    const r = run(["--plugin", dir(), "--project", dir()]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ANTHROPIC_API_KEY ausente");
  });

  it("requires --plugin and --project", () => {
    const noPlugin = run(["--project", dir()]);
    expect(noPlugin.status).toBe(2);
    expect(noPlugin.stderr).toContain("--plugin ausente");
    const noProject = run(["--plugin", dir()]);
    expect(noProject.status).toBe(2);
    expect(noProject.stderr).toContain("--project ausente");
  });

  it("rejects a missing plugin dir", () => {
    const env = { ANTHROPIC_API_KEY: "k" };
    const plugin = run(["--plugin", "/nao/existe", "--project", dir()], env);
    expect(plugin.status).toBe(2);
    expect(plugin.stderr).toContain("plugin não encontrado: /nao/existe");
    const project = run(["--plugin", dir(), "--project", "/nao/existe"], env);
    expect(project.status).toBe(2);
    expect(project.stderr).toContain("projeto não encontrado: /nao/existe");
  });
});
