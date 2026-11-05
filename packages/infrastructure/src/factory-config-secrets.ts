import { configProblem, type ConfigProblem } from "@friday/application";

export const SECRET_PREFIXES = ["sk-ant-", "ghp_", "gho_", "ghs_", "github_pat_"];

export function hasSecretPrefix(text: string): boolean {
  return SECRET_PREFIXES.some((prefix) => text.includes(prefix));
}

/** One `secret_value` per raw line that contains a known token prefix. */
export function scanSecrets(text: string, file: string): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (hasSecretPrefix(line)) problems.push(configProblem("secret_value", file, index + 1));
  });
  return problems;
}
