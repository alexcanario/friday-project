// Runs inside the container (or WSL2): a real query() that hunts for host secrets, then deterministic probes.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

const dir = import.meta.dirname;
const prompt = readFileSync(`${dir}/prompt.txt`, "utf8");
const hostPaths = JSON.parse(readFileSync(`${dir}/host-paths.json`, "utf8")) as string[];

function runProbe(name: string, args: string[]): void {
  const out = spawnSync("node", [`${dir}/probe.ts`, ...args], { encoding: "utf8", timeout: 20000 });
  let result: unknown = { error: out.stderr.slice(0, 200) };
  try {
    result = JSON.parse(out.stdout.trim().split("\n").pop() ?? "");
  } catch {
    // keep the error result
  }
  console.log(JSON.stringify({ type: "friday-probe", name, result }));
}

for await (const message of query({
  prompt,
  options: {
    cwd: dir,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 15,
    maxBudgetUsd: 1,
    settingSources: [],
  },
})) {
  console.log(JSON.stringify(message));
}

runProbe("fs", ["fs", JSON.stringify(hostPaths)]);
runProbe("tcp-direct", ["tcp", "example.com", "443"]);
runProbe("get-proxy", ["get", "http://example.com/"]);
