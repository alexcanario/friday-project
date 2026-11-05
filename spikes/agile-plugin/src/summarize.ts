import { readFileSync } from "node:fs";

export type Summary = {
  tools: string[];
  askUserQuestionCount: number;
  canUseToolCalls: number;
  subtype: string;
  totalCostUsd: number | null;
};

function parseJsonl(text: string): any[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

export function summarizeRun(messagesFile: string, canUseToolFile: string): Summary {
  const messages = parseJsonl(readFileSync(messagesFile, "utf8"));
  const canUse = JSON.parse(readFileSync(canUseToolFile, "utf8")) as unknown[];
  const results = messages.filter((m) => m?.type === "result");
  if (results.length === 0) throw new Error("mensagem result ausente");
  if (results.length > 1) throw new Error("mais de uma mensagem result");
  const uses: string[] = [];
  for (const m of messages) {
    if (m?.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    for (const block of m.message.content) {
      if (block?.type === "tool_use" && typeof block.name === "string") uses.push(block.name);
    }
  }
  return {
    tools: [...new Set(uses)],
    askUserQuestionCount: uses.filter((name) => name === "AskUserQuestion").length,
    canUseToolCalls: canUse.length,
    subtype: results[0].subtype,
    totalCostUsd: results[0].total_cost_usd ?? null,
  };
}
