import { checkRoster, configProblem, type ConfigProblem } from "@friday/application";
import {
  agentConfigSchema,
  factoryConfigSchema,
  type AgentConfig,
  type FactoryConfig,
} from "@friday/contracts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentExtraProblems } from "./factory-config-agent-checks.ts";
import { issuesToProblems, type SchemaIssue } from "./factory-config-issues.ts";
import { scanSecrets } from "./factory-config-secrets.ts";
import { parseYaml } from "./factory-config-yaml.ts";

export type LoadFactoryConfigResult =
  | { ok: true; config: FactoryConfig; agents: Record<string, AgentConfig> }
  | { ok: false; problems: ConfigProblem[] };

interface FileResult<T> {
  data: T | null;
  problems: ConfigProblem[];
}

function lt(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dedupe(problems: ConfigProblem[]): ConfigProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = JSON.stringify([p.file, p.line, p.code, p.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortProblems(problems: ConfigProblem[]): ConfigProblem[] {
  return dedupe(problems).sort(
    (a, b) => lt(a.file, b.file) || lt(a.line, b.line) || lt(a.code, b.code),
  );
}

function loadFile<T>(
  root: string,
  file: string,
  kind: "factory" | "agent",
  schema: {
    safeParse(
      v: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: SchemaIssue[] } };
  },
): FileResult<T> {
  let text: string;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    return { data: null, problems: [configProblem("missing_file", file, 1)] };
  }
  const problems = scanSecrets(text, file);
  const yaml = parseYaml(text);
  if (!yaml.ok)
    return { data: null, problems: [...problems, configProblem("yaml_invalid", file, yaml.line)] };
  const result = schema.safeParse(yaml.parsed.value);
  if (kind === "agent") problems.push(...agentExtraProblems(yaml.parsed, file, root));
  if (result.success) return { data: problems.length === 0 ? result.data : null, problems };
  problems.push(...issuesToProblems(yaml.parsed, file, result.error.issues, kind));
  return { data: null, problems };
}

function agentFiles(root: string): string[] {
  try {
    return readdirSync(join(root, "agents"))
      .filter(
        (name) =>
          name.endsWith(".yaml") &&
          name !== "triage.yaml" &&
          statSync(join(root, "agents", name)).isFile(),
      )
      .sort(lt);
  } catch {
    return [];
  }
}

export function loadFactoryConfig(root: string): LoadFactoryConfigResult {
  const problems: ConfigProblem[] = [];
  const factory = loadFile<FactoryConfig>(root, "factory.yaml", "factory", factoryConfigSchema);
  problems.push(...factory.problems);

  const files = agentFiles(root);
  if (files.length === 0) problems.push(configProblem("missing_file", "agents", 1));
  const agents: AgentConfig[] = [];
  let agentProblems = 0;
  for (const name of files) {
    const loaded = loadFile<AgentConfig>(root, `agents/${name}`, "agent", agentConfigSchema);
    problems.push(...loaded.problems);
    agentProblems += loaded.problems.length;
    if (loaded.data) agents.push(loaded.data);
  }
  if (agents.length > 0 && agentProblems === 0) problems.push(...checkRoster(agents));

  if (problems.length > 0 || !factory.data) return { ok: false, problems: sortProblems(problems) };
  return {
    ok: true,
    config: factory.data,
    agents: Object.fromEntries(agents.map((a) => [a.role, a])),
  };
}
