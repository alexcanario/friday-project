# Friday

Orquestrador de uma **fábrica de software agêntica**: issues são refinadas, implementadas, revisadas, testadas e entregues por agentes de IA, e o humano só entra nos gates. Stack: TypeScript, Claude Agent SDK, Fastify, SQLite e painel em React.

O Friday é construído por uma **fábrica noturna**: três tarefas agendadas do Claude Code na nuvem, que seguem o mesmo processo que o Friday vai automatizar.

## Comece por aqui
| Documento | Para quê |
|---|---|
| [`docs/process.md`](docs/process.md) | Estados, gates, Definition of Ready/Done, rotina do dono |
| [`docs/night.md`](docs/night.md) | Runbook das 3 fases da noite, tetos e economia |
| [`docs/night-prompts.md`](docs/night-prompts.md) | Prompts das tarefas agendadas |
| [`docs/schedule.md`](docs/schedule.md) | Milestones S1–S4, linha do tempo, go/no-go em 06/12 |
| [`docs/decisions.md`](docs/decisions.md) | Decisões em vigor (D1–D22) |
| [`docs/method-packs.md`](docs/method-packs.md) | Como o Friday hospeda o Agile e o Lens (D22) |
| [`docs/diagrams.md`](docs/diagrams.md) | Fluxo dia/noite, estados, decisão de merge, sequência, sync |
| [`docs/planning/`](docs/planning/) | Roteiro, backlog, agentes, gates, diagramas alvo, segunda opinião |
| [`docs/planning/08-implementation-roadmap.md`](docs/planning/08-implementation-roadmap.md), [`09-backlog.md`](docs/planning/09-backlog.md) e [`12-target-diagrams.md`](docs/planning/12-target-diagrams.md) | Roteiro, backlog e diagramas alvo (`docs/planning/09-backlog.md`, `docs/planning/12-target-diagrams.md`) |
| [`CLAUDE.md`](CLAUDE.md) | Regras para os agentes |

## Quadro
[GitHub Project **Friday**](https://github.com/users/alexcanario/projects/17), com o campo **Estado** espelhado das labels `status:*` pela Action `project-sync`. O quadro já existe: não rode de novo [`scripts/setup-github-project.ps1`](scripts/setup-github-project.ps1), porque ele cria outro Project.

## Interruptor da noite
Para suspender a noite, crie uma issue com a label `night:stop`. Para retomar, feche essa issue.

## Siglas
- **CI:** Continuous Integration.
- **SDK:** Software Development Kit.
