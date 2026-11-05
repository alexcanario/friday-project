import type { FactoryConfig } from "@friday/contracts";
import type { Risk } from "@friday/domain";
import { matchesGlob } from "./glob-match.ts";
import type { PrDiff } from "./pr-diff.ts";

export type RiskRuleName = FactoryConfig["risk"]["rules"][number];
export type RiskVerdict = { risk: Risk; rules: RiskRuleName[] };

export const MAX_DIFF_BYTES = 102400;

export const RISK_RULE_GLOBS: Record<Exclude<RiskRuleName, "size">, readonly string[]> = {
  migrations: ["**/migrations/**", "**/migrate/**", "**/alembic/**", "**/schema.rb"],
  infra: ["**/Dockerfile", "**/docker-compose*.yml", "**/*.tf", "infra/**", "k8s/**"],
  ci: [".github/**", ".gitlab-ci.yml", ".circleci/**", "**/Jenkinsfile"],
  dependencies: ["**/package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
  secrets: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/secrets/**"],
  agent_config: [".claude/**", "CLAUDE.md", "**/AGENTS.md", ".friday/**"],
};

const RULE_ORDER: readonly RiskRuleName[] = [
  "migrations",
  "infra",
  "ci",
  "dependencies",
  "secrets",
  "agent_config",
  "size",
];

const sizeExceeded = (diff: PrDiff, config: FactoryConfig["risk"]): boolean => {
  const lines = diff.files.reduce((sum, f) => sum + f.changedLines, 0);
  return (
    lines > config.max_changed_lines ||
    diff.files.length > config.max_changed_files ||
    diff.files.some((f) => !f.hasPatch)
  );
};

const ruleMatches = (rule: RiskRuleName, diff: PrDiff, config: FactoryConfig["risk"]): boolean =>
  rule === "size"
    ? sizeExceeded(diff, config)
    : diff.files.some((f) => RISK_RULE_GLOBS[rule].some((g) => matchesGlob(g, f.path)));

export const classifyRisk = (diff: PrDiff, config: FactoryConfig["risk"]): RiskVerdict => {
  const oversize = diff.diffBytes > MAX_DIFF_BYTES;
  const rules = RULE_ORDER.filter((rule) =>
    rule === "size" && oversize
      ? true
      : config.rules.includes(rule) && ruleMatches(rule, diff, config),
  );
  return { risk: rules.length > 0 ? "high" : "unclassified", rules };
};
