import { configProblem, type ConfigProblem } from "@friday/application";
import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { valueLine, type ParsedYaml } from "./factory-config-yaml.ts";

const ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;

function lexicallyUnsafe(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").includes("..")
  );
}

function isRegularFileInside(root: string, path: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(resolve(root, path));
    return real.startsWith(realRoot + sep) && statSync(real).isFile();
  } catch {
    return false;
  }
}

/** Checks that depend on the file name or the file system, beyond the schema. */
export function agentExtraProblems(p: ParsedYaml, file: string, root: string): ConfigProblem[] {
  if (p.value === null || typeof p.value !== "object" || Array.isArray(p.value)) return [];
  const raw = p.value as Record<string, unknown>;
  const problems: ConfigProblem[] = [];
  const expectedRole = file.replace(/^agents\//, "").replace(/\.yaml$/, "");
  if (typeof raw["role"] === "string" && ROLE_PATTERN.test(raw["role"])) {
    if (raw["role"] !== expectedRole) {
      problems.push(configProblem("role_mismatch", file, valueLine(p, ["role"])));
    }
  }
  const promptFile = raw["prompt_file"];
  if (typeof promptFile === "string" && promptFile.trim() !== "") {
    if (lexicallyUnsafe(promptFile) || !isRegularFileInside(root, promptFile)) {
      problems.push(configProblem("prompt_file_invalid", file, valueLine(p, ["prompt_file"])));
    }
  }
  return problems;
}
