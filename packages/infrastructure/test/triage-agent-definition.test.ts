import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFactoryConfig, loadTriageAgent } from "../src/index.ts";
import { scanSecrets } from "../src/factory-config-secrets.ts";
import { makeRoot, write } from "./config-helpers.ts";

const registry = resolve(import.meta.dirname, "../../../registry");
const FIRST_LINE =
  "You are the triage of this workspace. You read one issue, choose its specialist and copy its acceptance criteria; you do not change the code.";

function triageRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "friday-triage-"));
  mkdirSync(join(dir, "agents"));
  mkdirSync(join(dir, "prompts"));
  cpSync(join(registry, "agents/triage.yaml"), join(dir, "agents/triage.yaml"));
  cpSync(join(registry, "prompts/triage.md"), join(dir, "prompts/triage.md"));
  return dir;
}

const card = () => readFileSync(join(registry, "agents/triage.yaml"), "utf8");

function codes(root: string): string[] {
  const out = loadTriageAgent(root);
  if (out.ok) return [];
  return out.problems.map((p) => p.code);
}

describe("triage agent definition", () => {
  it("triage prompt starts with the fixed first line and asks for criteria", () => {
    const text = readFileSync(join(registry, "prompts/triage.md"), "utf8");
    expect(text.split("\n")[0]).toBe(FIRST_LINE);
    for (const word of ["specialist", "reason", "criteria"]) expect(text).toContain(word);
    expect(scanSecrets(text, "prompts/triage.md")).toEqual([]);
  });

  it("loads the triage card from the registry origin", () => {
    expect(loadTriageAgent(triageRoot())).toEqual({
      ok: true,
      agent: { maxTurns: 10, timeoutMs: 600000, promptFile: "prompts/triage.md" },
    });
  });

  it("rejects a missing, broken, mismatched or unsafe triage card", () => {
    const empty = mkdtempSync(join(tmpdir(), "friday-triage-empty-"));
    expect(codes(empty)).toContain("missing_file");

    const broken = triageRoot();
    write(broken, "agents/triage.yaml", "role: [triage\n");
    expect(codes(broken)).toContain("yaml_invalid");

    const role = triageRoot();
    write(role, "agents/triage.yaml", card().replace("role: triage", "role: backend"));
    expect(codes(role)).toContain("role_mismatch");

    for (const bad of ["/etc/passwd", "../x.md", "prompts/ausente.md"]) {
      const r = triageRoot();
      write(r, "agents/triage.yaml", card().replace("prompts/triage.md", bad));
      expect(codes(r), bad).toContain("prompt_file_invalid");
    }

    const states = triageRoot();
    write(states, "agents/triage.yaml", `${card()}states: [Todo]\n`);
    expect(codes(states)).toContain("unknown_key");

    const secret = triageRoot();
    write(secret, "agents/triage.yaml", `${card()}token: sk-ant-abc123\n`);
    expect(codes(secret)).toContain("secret_value");

    for (const r of [empty, broken, role, states, secret]) {
      expect(codes(r)).not.toContain("agent_without_state");
    }
  });

  it("loadFactoryConfig ignores agents/triage.yaml and still rejects other bad cards", () => {
    const root = makeRoot();
    write(root, "agents/triage.yaml", card());
    const ok = loadFactoryConfig(root);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(Object.keys(ok.agents)).not.toContain("triage");

    write(root, "agents/extra.yaml", "role: extra\n");
    const bad = loadFactoryConfig(root);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.some((p) => p.file === "agents/extra.yaml")).toBe(true);
  });
});
