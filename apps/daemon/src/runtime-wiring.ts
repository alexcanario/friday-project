import { isAbsolute, join } from "node:path";
import type { AgentRuntime, GitHost, GitHubPort, ToolDenialSink } from "@friday/application";
import {
  ClaudeAgentSdkRuntime,
  createResultStore,
  createRunLookup,
  type ClaudeAgentSdkRuntimeDeps,
  type FridayDatabase,
} from "@friday/infrastructure";
import type { RunContext } from "./run-recorder.ts";

export type RuntimeRepository = { owner: string; name: string };

/** Mirror directory of the target repository: `<FRIDAY_HOME or ~/.friday>/mirrors/<owner>__<name>.git` (D71). */
export function mirrorDirOf(input: {
  env: Record<string, string | undefined>;
  homeDir: string;
  repository: RuntimeRepository;
}): string {
  const configured = input.env.FRIDAY_HOME?.trim() ?? "";
  if (configured !== "" && !isAbsolute(configured)) {
    throw new Error("A variável FRIDAY_HOME deve ser um caminho absoluto.");
  }
  const base = configured !== "" ? configured : join(input.homeDir, ".friday");
  const { owner, name } = input.repository;
  const dir = join(base, "mirrors", `${owner}__${name}.git`);
  if (!isAbsolute(dir)) throw new Error("O diretório do espelho deve ser um caminho absoluto.");
  return dir;
}

/** GitHub https URL of the target repository (the host GitCliHost assumes for auth). */
export function targetUrlOf(repository: RuntimeRepository): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

export interface RuntimeWiringDeps {
  db: FridayDatabase;
  github: GitHubPort;
  gitHost: GitHost;
  env: Record<string, string | undefined>;
  createRuntime?: (deps: ClaudeAgentSdkRuntimeDeps) => AgentRuntime;
}

/** A fresh runtime per run, bound to that run's denial sink. */
export function buildRuntimeFor(
  deps: RuntimeWiringDeps,
): (ctx: RunContext, sink: ToolDenialSink) => AgentRuntime {
  const create = deps.createRuntime ?? ((d) => new ClaudeAgentSdkRuntime(d));
  return (_ctx, sink) =>
    create({
      env: deps.env,
      sink,
      runs: createRunLookup(deps.db),
      results: createResultStore(deps.db),
      github: deps.github,
      gitHost: deps.gitHost,
    });
}
