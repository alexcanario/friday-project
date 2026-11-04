import { resultSchema } from "./schema.ts";

export type Summary = {
  tools: string[];
  subtype: string;
  totalCostUsd: number | null;
  numTurns: number | null;
  structuredOutputValid: boolean;
};

export function parseJsonl(text: string): any[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

export function summarizeMessages(messages: any[]): Summary {
  const results = messages.filter((m) => m?.type === "result");
  if (results.length === 0) throw new Error("mensagem result ausente");
  if (results.length > 1) throw new Error("mais de uma mensagem result");
  const result = results[0];
  const init = messages.find((m) => m?.type === "system" && m?.subtype === "init");
  return {
    tools: Array.isArray(init?.tools) ? init.tools : [],
    subtype: result.subtype,
    totalCostUsd: result.total_cost_usd ?? null,
    numTurns: result.num_turns ?? null,
    structuredOutputValid: resultSchema.safeParse(result.structured_output).success,
  };
}
