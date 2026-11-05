# Spike: Agent SDK numa worktree

Spike da issue #9. Monta a chamada `query()` do Claude Agent SDK com os tetos e travas da fábrica. Por D26, este PR entrega só código testado sem chave de API; as rodadas reais são da issue #31.

## Versões

- `@anthropic-ai/claude-agent-sdk` `0.3.318` (fixa o Claude Code `2.1.318` embutido).
- `zod` `4.6.7` e `vitest` `5.1.0`.
- Os peers do SDK (`@modelcontextprotocol/sdk` e `@anthropic-ai/sdk`) ficam só no `pnpm-lock.yaml` do spike.
- A pasta `spikes/agent-sdk/` está fora do workspace pnpm da raiz.

## O que exige chave de API

- Cobertos sem chave (CI): montagem das opções, ambiente mínimo, esquema, hook, ferramenta em processo, worktree, gravação dos logs com `query` falso e o resumo dos logs.
- Exigem chave (issue #31): custo real, `error_max_budget_usd`, `error_max_turns`, `Write` negado de fato, saída estruturada validada e os itens 1 e 2 abaixo.

## Comando para o dono

```bash
pnpm --dir spikes/agent-sdk --ignore-workspace install
cd spikes/agent-sdk
export ANTHROPIC_API_KEY=...   # nunca versionar
node run.ts --repo <caminho-do-repo> --mode normal
node run.ts --repo <caminho-do-repo> --mode budget
node run.ts --repo <caminho-do-repo> --mode turns
node run.ts --repo <caminho-do-repo> --mode write
node run.ts --repo <caminho-do-repo> --mode canuse
node run.ts --repo <caminho-do-repo> --mode violation
node summarize.ts spike/normal.messages.jsonl
```

No Windows, acrescente `--env-keys SystemRoot,USERPROFILE,TEMP`. Cada rodada grava `spike/<modo>.messages.jsonl` e `spike/<modo>.can-use-tool.json`. A #31 versiona esses arquivos e substitui `pendente` abaixo.

## Item 1: validador draft-07

pendente (rodada `--mode violation`, issue #31): confirmar se o SDK valida a saída contra o esquema draft-07 gerado pelo Zod (`minLength` e `minimum`).

## Item 2: canUseTool em dontAsk

pendente (rodada `--mode canuse`, issue #31): confirmar se `canUseTool` é chamado em `permissionMode: "dontAsk"` quando `Write` está exposto e sem hook.

## Siglas

- CI: integração contínua.
- SDK: kit de desenvolvimento de software (Agent SDK).
- API: interface de programação de aplicações.
- MCP: protocolo de contexto de modelo.
