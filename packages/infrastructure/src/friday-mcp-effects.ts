import {
  checkEffect,
  type EffectsRun,
  type EffectTool,
  type GitHost,
  type GitHubPort,
  type RunLookup,
} from "@friday/application";
import type { AgentConfig } from "@friday/contracts";
import type { IssueState } from "@friday/domain";
import { z } from "zod";

export type ToolResponse = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export interface EffectsInput {
  github: GitHubPort;
  gitHost: GitHost;
  run: EffectsRun;
}

export const EFFECT_KEYS: Record<EffectTool, string[]> = {
  git_push: ["branch", "message"],
  pr_create: ["title", "body"],
  pr_diff: [],
  issue_comment: ["body"],
};
export const EFFECT_DESCRIPTIONS: Record<EffectTool, string> = {
  git_push: "Faz o commit das alterações do worktree e envia a branch da run ao remoto.",
  pr_create: "Abre o PR da run (ou devolve o existente).",
  pr_diff: "Devolve o resumo do diff do PR da run.",
  issue_comment: "Publica um comentário na issue da run.",
};

const reply = (text: string, isError?: true): ToolResponse => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError } : {}),
});

const schemas = (run: EffectsInput["run"]): Record<EffectTool, z.ZodType> => ({
  git_push: z.strictObject({
    branch: z.literal(run.branch),
    message: z.string().min(1),
  }),
  pr_create: z.strictObject({ title: z.string(), body: z.string() }),
  pr_diff: z.strictObject({}),
  issue_comment: z.strictObject({ body: z.string() }),
});

type Deps = {
  runId: string;
  agent: Pick<AgentConfig, "states" | "mcp_tools">;
  getIssueState: () => IssueState;
  runs: RunLookup;
  effects: EffectsInput;
};

async function execute(
  name: EffectTool,
  args: { branch: string; message: string; title: string; body: string },
  { github, gitHost, run }: EffectsInput,
) {
  switch (name) {
    case "git_push": {
      const { sha } = await gitHost.push({
        worktree: run.worktree,
        branch: args.branch,
        message: args.message,
      });
      try {
        run.onPushed?.(sha);
      } catch {
        // O push já foi feito; um gancho com defeito não pode virar 500.
      }
      return reply(`200: push feito: ${sha}.`);
    }
    case "pr_create": {
      const pr = await github.createPullRequest({
        head: run.branch,
        base: run.base,
        title: args.title,
        body: args.body,
      });
      try {
        run.onPrCreated?.(pr.number);
      } catch {
        // O PR já existe; um gancho com defeito não pode virar 500.
      }
      return reply(`200: PR #${pr.number} ${pr.created ? "aberto" : "já existia"}.`);
    }
    case "pr_diff": {
      const pr = run.getPullRequest();
      if (pr === null) return reply("404: A run ainda não tem PR.", true);
      return reply(JSON.stringify(await github.getPrReviewDiff(pr)));
    }
    case "issue_comment":
      await github.postAgentComment(run.issue, run.role, args.body);
      return reply("200: comentário publicado.");
  }
}

export function makeEffectHandler(name: EffectTool, deps: Deps) {
  const schema = schemas(deps.effects.run)[name];
  return async (args: unknown): Promise<ToolResponse> => {
    const gate = checkEffect({
      tool: name,
      agent: deps.agent,
      issueState: deps.getIssueState(),
      runActive: deps.runs.isActive(deps.runId),
    });
    if (gate.status !== 200) return reply(`${gate.status}: ${gate.message}`, true);
    const parsed = schema.safeParse(args);
    if (!parsed.success) return reply(`422: Entrada inválida para ${name}.`, true);
    try {
      return await execute(name, parsed.data as Parameters<typeof execute>[1], deps.effects);
    } catch (error) {
      try {
        deps.effects.run.onEffectError?.(name, error);
      } catch {
        // Um gancho com defeito não pode mudar a resposta nem derrubar o handler.
      }
      return reply(`500: Falha ao executar ${name} (effect_failed).`, true);
    }
  };
}
