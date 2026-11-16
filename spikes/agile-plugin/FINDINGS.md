# Spike D16: carregar o plugin agile@canary pelo Agent SDK

Código testado sem chave de API (issue #10). A rodada real exige chave e é da issue #57 (D26).

## Versões

- `@anthropic-ai/claude-agent-sdk` `0.3.318`
- `zod` `4.6.7`
- `vitest` `5.1.0`
- Node 26, pnpm `12.16.1`

## Comando para o dono

Instalação (a pasta fica fora do workspace):

```
pnpm --dir spikes/agile-plugin --ignore-workspace install --frozen-lockfile
```

Rodada real (limites fixos: 10 turnos e US$ 0,50, D44):

```
cd spikes/agile-plugin
ANTHROPIC_API_KEY=... node run.ts --plugin <pasta-do-plugin-agile> --project <pasta-do-projeto> --args="<argumentos>"
```

O prompt enviado é `/agile:autopilot ` seguido do valor de `--args=`. Em Windows, acrescente `--env-keys SystemRoot,USERPROFILE,TEMP`.

Depois da rodada, resuma:

```
node summarize.ts spike/plugin.messages.jsonl spike/plugin.can-use-tool.json
```

## Rodada real (#57)

Rodadas em 15/11 com `agile@canary` 0.331.0, projeto de rascunho com a feature `F-1` em `idea` e `/agile:autopilot F-1 --assume`. Custo de cerca de US$ 0,20 por rodada, US$ 0,79 no total (3 rodadas com resultado). `spike/` guarda a 3ª rodada, a mais completa. Foi acrescentado `--permissive` (libera `Skill`, leitura, `Bash` com scripts do plugin ou `git` e escrita ao lado do rascunho; `AskUserQuestion` continua negada e registrada), além de `--max-budget` e `--max-turns`.

1. Sem `--permissive`: o plugin carregou e a skill rodou, mas o 1º `Bash` foi negado por `canUseTool` e o agente parou.
2. Com `--permissive`: `dispatch.js` recusou o rascunho (`checkout is on master, not on the main branch main`); renomeado para `main` no rascunho.
3. Com `--permissive` e a branch certa: `resolve-issue.js route` e `dispatch.js plan` rodaram e gravaram a lane `jussara` (F-1, sonnet). O agente leu o teto de US$ 0,50 e parou antes de construir.
4. Rodada com `--max-budget 3 --max-turns 40`: ficou parada por cerca de 19 minutos sem alterar o rascunho e foi interrompida pelo dono com `Ctrl+C`; não gravou log (o `run.ts` só grava ao terminar).

Provado: o plugin carrega por `plugins: [{ type: "local", path }]`, aparece em `system:init` (`agile@inline`, versão 0.331.0), expõe os comandos `agile:*`, a skill `agile:resolve-run` roda pela ferramenta `Skill` e os scripts do plugin funcionam por `Bash`.

## Paradas humanas

Não provado. As duas paradas (rodada de perguntas e script de validação) não foram alcançadas: com `--assume` não há rodada de perguntas, e o limite de US$ 0,50 impediu chegar ao script de validação. `AskUserQuestion` foi chamada 0 vezes e `canUseTool` recebeu só chamadas de `Bash`. Falta uma rodada sem `--assume` e com limite maior.

## Hooks

Parcial. O hook `SessionStart` do plugin disparou (`[agile] branch main`, `Backlog head: F-1 Hello CLI (idea)`). Nenhum evento de hook `PreToolUse` apareceu no fluxo de mensagens, então `guard.js` e `run-guard.js` não foram vistos disparando nem bloqueando: ou o SDK não emite esses eventos, ou não dispararam. Falta uma rodada que chegue ao `run-guard` e a um `Bash` bloqueável.

## Quem move o Status

Não provado. A F-1 continuou `idea` em todas as rodadas; o plugin só gravou a lane em `.git/agile/lanes.json`. Falta ver o refinamento e o build.

## Recomendação D16

Ajustar, não aceitar ainda. Carregar o plugin pelo SDK funciona, mas as três perguntas centrais ficaram sem prova. O projeto exige branch `main`, e o limite padrão da D44 (US$ 0,50 e 10 turnos) não cobre uma lane. Próximo passo: uma rodada sem `--assume`, com limite maior e acompanhada pelo dono, em issue própria. A issue de `plugins` no `agentConfigSchema` só se abre depois dela.

## Siglas

- API: Application Programming Interface (interface de programação de aplicações).
- CI: Continuous Integration (integração contínua).
- SDK: Software Development Kit (kit de desenvolvimento de software).
- D16, D26, D44: decisões numeradas em `docs/decisions.md`.
