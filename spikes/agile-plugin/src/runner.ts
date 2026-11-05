import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPluginOptions, type BuildPluginOptionsInput, type CanUseCall } from "./options.ts";

export type QueryFn = (params: { prompt: string; options: any }) => AsyncIterable<unknown>;

export type RunPluginSpikeInput = {
  query: QueryFn;
  prompt: string;
  optionsInput: Omit<BuildPluginOptionsInput, "recordCanUse">;
  outDir: string;
};

export async function runPluginSpike(input: RunPluginSpikeInput): Promise<void> {
  const canUseCalls: CanUseCall[] = [];
  const options = buildPluginOptions({
    ...input.optionsInput,
    recordCanUse: (call) => canUseCalls.push(call),
  });
  const lines: string[] = [];
  try {
    for await (const message of input.query({ prompt: input.prompt, options })) {
      lines.push(JSON.stringify(message));
    }
  } finally {
    // O SDK lança depois de entregar um resultado de erro; os logs precisam sobreviver a isso.
    mkdirSync(input.outDir, { recursive: true });
    writeFileSync(
      join(input.outDir, "plugin.messages.jsonl"),
      lines.map((line) => `${line}\n`).join(""),
    );
    writeFileSync(
      join(input.outDir, "plugin.can-use-tool.json"),
      `${JSON.stringify(canUseCalls, null, 2)}\n`,
    );
  }
}
