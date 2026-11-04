import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOptions, type CanUseCall } from "./options.ts";
import { resolvePreset } from "./presets.ts";
import { createWorktree } from "./worktree.ts";

export type QueryFn = (params: { prompt: string; options: any }) => AsyncIterable<unknown>;

export type RunSpikeInput = {
  repo: string;
  mode: string;
  outDir: string;
  env: Record<string, string>;
  query: QueryFn;
};

export async function runSpike(input: RunSpikeInput): Promise<{ worktree: string }> {
  const preset = resolvePreset(input.mode);
  const base = mkdtempSync(join(tmpdir(), `friday-spike-${input.mode}-`));
  const worktree = join(base, "worktree");
  await createWorktree(input.repo, worktree);

  const canUseCalls: CanUseCall[] = [];
  const options = buildOptions({
    cwd: worktree,
    env: input.env,
    maxTurns: preset.maxTurns,
    maxBudgetUsd: preset.maxBudgetUsd,
    exposeWrite: preset.exposeWrite,
    withHook: preset.withHook,
    recordCanUse: (call) => canUseCalls.push(call),
  });

  const lines: string[] = [];
  for await (const message of input.query({ prompt: preset.prompt, options })) {
    lines.push(JSON.stringify(message));
  }

  mkdirSync(input.outDir, { recursive: true });
  writeFileSync(
    join(input.outDir, `${input.mode}.messages.jsonl`),
    lines.map((line) => `${line}\n`).join(""),
  );
  writeFileSync(
    join(input.outDir, `${input.mode}.can-use-tool.json`),
    `${JSON.stringify(canUseCalls, null, 2)}\n`,
  );
  return { worktree };
}
