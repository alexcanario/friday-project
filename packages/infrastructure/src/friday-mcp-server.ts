import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  checkResult,
  EFFECT_TOOLS,
  RESULT_TOOLS,
  type EffectTool,
  type ResultStore,
  type ResultTool,
  type RunLookup,
} from "@friday/application";
import type { AgentConfig } from "@friday/contracts";
import type { IssueState } from "@friday/domain";
import { z } from "zod";
import {
  EFFECT_DESCRIPTIONS,
  EFFECT_KEYS,
  makeEffectHandler,
  type EffectsInput,
  type ToolResponse,
} from "./friday-mcp-effects.ts";

export type { ToolResponse };

const loose = z.unknown().optional();
// Top-level keys per contract; listed literally because the schemas expose no uniform `.shape`.
const KEYS: Record<ResultTool, string[]> = {
  criteria_set: ["criteria"],
  work_report: ["summary", "headSha", "changedFiles", "notDone"],
  qa_report: ["verdict", "criteria", "notChecked"],
  review_verdict: ["verdict", "headSha", "rules", "findings", "risk"],
};
const DESCRIPTIONS: Record<ResultTool, string> = {
  criteria_set: "Envia os critérios de aceite da issue.",
  work_report: "Envia o relatório do trabalho feito.",
  qa_report: "Envia o relatório de QA.",
  review_verdict: "Envia o veredito da revisão.",
};
export const resultToolShape = (name: ResultTool): Record<string, z.ZodType> =>
  Object.fromEntries(KEYS[name].map((key) => [key, loose]));

export interface FridayMcpServerInput {
  runId: string;
  agent: Pick<AgentConfig, "states" | "mcp_tools">;
  getIssueState: () => IssueState;
  runs: RunLookup;
  results: ResultStore;
  effects?: EffectsInput;
}

function makeResultHandler(name: ResultTool, input: FridayMcpServerInput) {
  return (args: unknown): Promise<ToolResponse> => {
    const outcome = checkResult(
      { runs: input.runs, results: input.results },
      {
        runId: input.runId,
        tool: name,
        agent: input.agent,
        issueState: input.getIssueState(),
        input: args,
      },
    );
    if (outcome.status === 200) {
      return Promise.resolve({ content: [{ type: "text", text: "200: resultado aceito." }] });
    }
    const detail =
      outcome.status === 422
        ? outcome.violations.map((v) => v.message).join("\n")
        : outcome.message;
    return Promise.resolve({
      content: [{ type: "text", text: `${outcome.status}: ${detail}` }],
      isError: true,
    });
  };
}

export function createFridayMcpServer(input: FridayMcpServerInput): {
  server: ReturnType<typeof createSdkMcpServer>;
  toolNames: string[];
  handlers: Partial<Record<ResultTool | EffectTool, (args: unknown) => Promise<ToolResponse>>>;
} {
  const names = input.agent.mcp_tools.filter((t): t is ResultTool => t in RESULT_TOOLS);
  const handlers: Partial<
    Record<ResultTool | EffectTool, (args: unknown) => Promise<ToolResponse>>
  > = {};
  const effectNames = input.agent.mcp_tools.filter((t): t is EffectTool =>
    (EFFECT_TOOLS as readonly string[]).includes(t),
  );
  const effects = input.effects;
  if (effectNames.length > 0 && !effects) {
    throw new Error(`Porta ausente para a ferramenta ${effectNames[0]}.`);
  }
  for (const name of names) handlers[name] = makeResultHandler(name, input);
  const tools = names.map((name) =>
    tool(name, DESCRIPTIONS[name], resultToolShape(name), (args) => handlers[name]!(args)),
  );
  const effectTools = effectNames.map((name) => {
    handlers[name] = makeEffectHandler(name, { ...input, effects: effects! });
    // Loose object keeps unknown keys so the strict handler schema can reject them with 422.
    const shape = z.looseObject(Object.fromEntries(EFFECT_KEYS[name].map((key) => [key, loose])));
    return tool(
      name,
      EFFECT_DESCRIPTIONS[name],
      shape as unknown as Record<string, typeof loose>,
      (args) => handlers[name]!(args),
    );
  });
  return {
    server: createSdkMcpServer({ name: "friday", tools: [...tools, ...effectTools] }),
    toolNames: [...names, ...effectNames].map((name) => `mcp__friday__${name}`),
    handlers,
  };
}
