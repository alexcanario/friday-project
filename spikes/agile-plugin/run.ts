import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildEnv } from "./src/env.ts";
import { buildPrompt } from "./src/options.ts";
import { RUN_MAX_BUDGET_USD, RUN_MAX_TURNS } from "./src/presets.ts";
import { runPluginSpike } from "./src/runner.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    plugin: { type: "string" },
    project: { type: "string" },
    args: { type: "string", default: "" },
    "env-keys": { type: "string", default: "" },
  },
});

if (!values.plugin) fail("--plugin ausente");
if (!values.project) fail("--project ausente");
const extraKeys = (values["env-keys"] as string).split(",").filter((k) => k !== "");
const env = buildEnv(process.env, extraKeys);
if (!env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY ausente");
if (!existsSync(values.plugin)) fail(`plugin não encontrado: ${values.plugin}`);
if (!existsSync(values.project)) fail(`projeto não encontrado: ${values.project}`);

await runPluginSpike({
  query: query as any,
  prompt: buildPrompt(values.args as string),
  optionsInput: {
    cwd: values.project,
    pluginPath: values.plugin,
    env,
    maxTurns: RUN_MAX_TURNS,
    maxBudgetUsd: RUN_MAX_BUDGET_USD,
  },
  outDir: fileURLToPath(new URL("./spike", import.meta.url)),
});
console.log("rodada concluída; veja spike/plugin.messages.jsonl");
