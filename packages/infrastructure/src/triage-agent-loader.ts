import { configProblem, type ConfigProblem } from "@friday/application";
import { triageAgentConfigSchema } from "@friday/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentExtraProblems } from "./factory-config-agent-checks.ts";
import { issuesToProblems } from "./factory-config-issues.ts";
import { scanSecrets } from "./factory-config-secrets.ts";
import { parseYaml } from "./factory-config-yaml.ts";

const FILE = "agents/triage.yaml";

export type LoadTriageAgentResult =
  | { ok: true; agent: { maxTurns: number; timeoutMs: number; promptFile: string } }
  | { ok: false; problems: ConfigProblem[] };

/** Reads and validates `<root>/agents/triage.yaml`; ok only with zero problems. */
export function loadTriageAgent(root: string): LoadTriageAgentResult {
  let text: string;
  try {
    text = readFileSync(join(root, FILE), "utf8");
  } catch {
    return { ok: false, problems: [configProblem("missing_file", FILE, 1)] };
  }
  const problems = scanSecrets(text, FILE);
  const yaml = parseYaml(text);
  if (!yaml.ok) {
    return { ok: false, problems: [...problems, configProblem("yaml_invalid", FILE, yaml.line)] };
  }
  const result = triageAgentConfigSchema.safeParse(yaml.parsed.value);
  problems.push(...agentExtraProblems(yaml.parsed, FILE, root));
  if (!result.success) {
    problems.push(...issuesToProblems(yaml.parsed, FILE, result.error.issues, "factory"));
  }
  if (problems.length > 0 || !result.success) return { ok: false, problems };
  const { max_turns, timeout_s, prompt_file } = result.data;
  return {
    ok: true,
    agent: { maxTurns: max_turns, timeoutMs: timeout_s * 1000, promptFile: prompt_file },
  };
}
