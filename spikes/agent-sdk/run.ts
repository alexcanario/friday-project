import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildEnv } from "./src/env.ts";
import { resolvePreset } from "./src/presets.ts";
import { runSpike } from "./src/runner.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    mode: { type: "string", default: "normal" },
    "env-keys": { type: "string", default: "" },
  },
});

if (!values.repo) fail("--repo ausente");
const mode = values.mode as string;
try {
  resolvePreset(mode);
} catch (error) {
  fail((error as Error).message);
}
const extraKeys = (values["env-keys"] as string).split(",").filter((k) => k !== "");
const env = buildEnv(process.env, extraKeys);
if (!env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY ausente");

const { worktree } = await runSpike({
  repo: values.repo,
  mode,
  outDir: fileURLToPath(new URL("./spike", import.meta.url)),
  env,
  query: query as any,
});
console.log(`rodada ${mode} concluída; worktree: ${worktree}`);
