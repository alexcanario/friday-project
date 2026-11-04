import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const SPIKE_SERVER_NAME = "spike";
export const SPIKE_TOOL_FULL_NAME = "mcp__spike__record";

export function createSpikeTools() {
  const calls: string[] = [];
  const recordShape = { note: z.string() };
  const record = async (args: { note: string }, _extra?: unknown) => {
    calls.push(args.note);
    return { content: [{ type: "text" as const, text: "registrado" }] };
  };
  const server = createSdkMcpServer({
    name: SPIKE_SERVER_NAME,
    tools: [tool("record", "Registra uma anotação do spike", recordShape, record)],
  });
  return { server, calls, record, recordShape };
}
