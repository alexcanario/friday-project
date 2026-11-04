# Friday

Orquestrador de uma **fábrica de software agêntica**: issues são refinadas, implementadas, revisadas, testadas e entregues por agentes de IA, e o humano só entra nos gates. Stack: TypeScript, Claude Agent SDK, Fastify, SQLite e painel em Blazor WASM.

O Friday é construído por uma **fábrica noturna**: três tarefas agendadas do Claude Code na nuvem, que seguem o mesmo processo que o Friday vai automatizar.

## Comece por aqui
| Documento | Para quê |
|---|---|
| [`docs/processo.md`](docs/processo.md) | Estados, gates, Definition of Ready/Done, rotina do dono |
| [`docs/noite.md`](docs/noite.md) | Runbook das 3 fases da noite, tetos e economia |
| [`docs/noite-prompts.md`](docs/noite-prompts.md) | Prompts das tarefas agendadas |
| [`docs/cronograma.md`](docs/cronograma.md) | Milestones S1–S4, linha do tempo, go/no-go em 06/12 |
| [`docs/decisoes.md`](docs/decisoes.md) | Decisões em vigor (D1–D20) |
| [`docs/diagramas.md`](docs/diagramas.md) | Fluxo dia/noite, estados, decisão de merge, sequência, sync |
| [`docs/planejamento/`](docs/planejamento/) | Roteiro, backlog, agentes, gates, diagramas alvo, segunda opinião |
| [`CLAUDE.md`](CLAUDE.md) | Regras para os agentes |

## Quadro
GitHub Project **Friday**, com o campo **Estado** espelhado das labels `status:*` pela Action `project-sync`. Para criar o quadro (uma vez): [`scripts/setup-github-project.ps1`](scripts/setup-github-project.ps1).

## Interruptor da noite
Para suspender a noite, crie uma issue com a label `night:stop`. Para retomar, feche essa issue.

## Siglas
- **CI:** Continuous Integration.
- **SDK:** Software Development Kit.
- **WASM:** WebAssembly.
