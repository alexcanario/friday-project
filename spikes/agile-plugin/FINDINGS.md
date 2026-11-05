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
ANTHROPIC_API_KEY=... node run.ts --plugin <pasta-do-plugin-agile> --project <pasta-do-projeto> --args "<argumentos>"
```

O prompt enviado é `/agile:autopilot ` seguido de `--args`. Em Windows, acrescente `--env-keys SystemRoot,USERPROFILE,TEMP`.

Depois da rodada, resuma:

```
node summarize.ts spike/plugin.messages.jsonl spike/plugin.can-use-tool.json
```

## Paradas humanas

pendente: as duas paradas aparecem como `AskUserQuestion` ou `canUseTool`? (#57)

## Hooks

pendente: os hooks `guard.js` e `run-guard.js` disparam? (#57)

## Quem move o Status

pendente: o plugin ou o agente move o Status do quadro? (#57)

## Recomendação D16

pendente: aceitar, ajustar ou recusar o carregamento do plugin pelo Agent SDK. (#57)

## Siglas

- API: Application Programming Interface (interface de programação de aplicações).
- CI: Continuous Integration (integração contínua).
- SDK: Software Development Kit (kit de desenvolvimento de software).
- D16, D26, D44: decisões numeradas em `docs/decisions.md`.
