# Spike: Agent SDK numa worktree

Spike das issues #9 e #31. A #9 montou a chamada `query()` do Claude Agent SDK com os tetos e travas da fábrica, testada sem chave de API (D26). A #31 rodou as seis rodadas reais em 05/11/2026, no Windows, e os logs estão em `spike/`.

## Versões

- `@anthropic-ai/claude-agent-sdk` `0.3.318` (fixa o Claude Code `2.1.318` embutido).
- `zod` `4.6.7` e `vitest` `5.1.0`.
- Os peers do SDK (`@modelcontextprotocol/sdk` e `@anthropic-ai/sdk`) ficam só no `pnpm-lock.yaml` do spike.
- A pasta `spikes/agent-sdk/` está fora do workspace pnpm da raiz.

## O que exige chave de API

- Cobertos sem chave (CI): montagem das opções, ambiente mínimo, esquema, hook, ferramenta em processo, worktree, gravação dos logs com `query` falso e o resumo dos logs.
- Provados com chave (issue #31): custo real, `error_max_budget_usd`, `error_max_turns`, `Write` negado de fato, saída estruturada validada e os itens 1 e 2 abaixo.

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

No Windows, acrescente `--env-keys SystemRoot,USERPROFILE,TEMP` e use um clone de caminho curto (veja "Pontos para a #16"). Cada rodada grava `spike/<modo>.messages.jsonl` e `spike/<modo>.can-use-tool.json`, mesmo quando termina em erro.

## Resultados das rodadas

Custo total: 0,19 USD.

| Modo | Teto | Resultado (`subtype`) | Turnos | Custo (USD) | O que provou |
|---|---|---|---|---|---|
| `normal` | 10 turnos, 0,50 USD | `success` | 3 | 0,0489 | Saída estruturada válida; ferramentas `Glob`, `Grep`, `Read`, `StructuredOutput` e `mcp__spike__record` |
| `budget` | 10 turnos, 0,01 USD | `error_max_budget_usd` | 1 | 0,0190 | O teto de custo para a rodada, mas depois de ultrapassado |
| `turns` | 1 turno, 0,50 USD | `error_max_turns` | 2 | 0,0190 | O teto de turnos para a rodada; `num_turns` veio como 2 |
| `write` | 10 turnos, 0,50 USD | `success` | 3 | 0,0436 | O hook `PreToolUse` negou `Write`; `spike.txt` não foi criado |
| `canuse` | 10 turnos, 0,50 USD | `success` | 3 | 0,0294 | Sem hook, o `dontAsk` negou `Write`; `spike.txt` não foi criado |
| `violation` | 10 turnos, 0,50 USD | `success` | 3 | 0,0300 | O esquema rejeitou a saída inválida (item 1) |

Nas rodadas `write` e `canuse`, a worktree terminou sem alterações. Nelas, `success` só diz que a rodada terminou: o agente relatou que não criou o arquivo.

## Item 1: validador draft-07

Confirmado (rodada `--mode violation`): o SDK valida a saída contra o esquema draft-07 gerado pelo Zod. A chamada de `StructuredOutput` com `summary` vazio e `count` 0 voltou com erro, citando `minLength` e `minimum` ("must NOT have fewer than 1 characters" e "must be >= 1"). O agente tentou de novo com valores válidos, e essa segunda saída foi a aceita. A rejeição não encerra a rodada; ela consome turno e custo.

## Item 2: canUseTool em dontAsk

Confirmado que não é chamado (rodada `--mode canuse`): com `Write` exposto, sem hook e em `permissionMode: "dontAsk"`, `spike/canuse.can-use-tool.json` ficou vazio. A negação veio do próprio `dontAsk`, com `system/permission_denied` e `permission_denials` no resultado. O `canUseTool` não serve como trava nesse modo.

## Pontos para a #16

1. **O SDK lança exceção depois de um resultado de erro.** A mensagem `result` chega antes, com o `subtype` certo, e depois o iterador lança "Claude Code returned an error result". O adaptador precisa guardar o que recebeu e classificar pelo `subtype`, não pela exceção. A função `runSpike` agora grava os logs num `finally`.
2. **`maxBudgetUsd` não é limite rígido.** A rodada `budget` gastou 0,0190 USD com teto de 0,01 USD, porque o custo só é conferido depois da resposta. A #21 precisa contar com essa folga de até uma resposta do modelo.
3. **Sem `model`, a rodada usa `claude-opus-5-5`.** A D8 pede Sonnet para implementar e Opus só em parte do Judge, então o adaptador precisa sempre passar `model`. A rodada `normal` também registrou um pequeno uso de `claude-haiku-5-5`.
4. **`settingSources: ["project"]` carrega os agentes do repositório.** O `init` lista `implementer`, `judge`, `judge-strong`, `qa`, `refiner` e `reporter`, vindos da pasta `.claude/`. A nota da #9 continua valendo: essa opção não passa para a #16 sem decisão.
5. **No Windows, caminho longo impede o início.** Com cerca de 270 caracteres até `claude.exe`, o início falha com `ENOENT`, e a mensagem sugere um problema de `libc` que não é a causa. O erro acontece antes de qualquer chamada à API, então não há custo.

## Limites desta prova

- Uma rodada por modo, no Windows, com um prompt curto. Os custos são uma amostra, não uma média.
- O prompt de `violation` pediu a saída inválida de propósito.
- A negação do `dontAsk` diz ao agente que ele pode tentar outras ferramentas. O agente não tentou, mas a #17 não deve contar com isso.

## Siglas

- API: interface de programação de aplicações.
- CI: integração contínua.
- MCP: protocolo de contexto de modelo.
- SDK: kit de desenvolvimento de software (Agent SDK).
