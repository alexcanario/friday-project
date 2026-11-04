# Decisões vigentes

Fonte única das decisões em vigor. O histórico e o raciocínio estão em `planejamento/08-roteiro-implementacao.md` §0 e `planejamento/13-segunda-opiniao.md`. Quando uma decisão muda, a linha é atualizada aqui no mesmo commit.

> Duas coisas diferentes: a **fábrica que constrói o Friday** (sessões agendadas na nuvem, hoje) e o **Friday como produto** (o orquestrador TypeScript, que um dia substitui essas sessões). As decisões marcadas *produto* valem para o código do Friday.

| Id | Decisão | Estado | Data |
|---|---|---|---|
| D1 | Orquestrador em TypeScript + Claude Agent SDK (*produto*) | fechada | 2026-11-04 |
| D2 | GitHub Issues + GitHub Project como tracker; estado espelhado por labels `status:*` | fechada | 2026-11-04 |
| D4 | Credencial do Friday produto: chave de API; a assinatura é tratada como bônus instável | fechada | 2026-11-04 |
| D6′ | Merge automático em `develop` do que a IA validou (CI + QA + Judge), exceto com gate | fechada | 2026-11-04 |
| D8 | Modelos por papel: Haiku relatório, Sonnet refinar/implementar/QA/Judge, Opus só no Judge com gate ou risco ≥ medium | fechada | 2026-11-04 |
| D9 | SQLite (better-sqlite3) + Drizzle, WAL, um processo escritor (*produto*) | fechada | 2026-11-04 |
| D13 | Painel: Blazor WASM + cliente C# gerado do OpenAPI (*produto*) | **a confirmar pelo dono** (issue "Decidir D13") | — |
| D14 | Multi-projeto com `project_id` desde o início; política de segurança fora do repositório do projeto (*produto*) | fechada | 2026-11-04 |
| D15 | Nome `friday` em tudo (label, CLI, `mcp__friday__*`, `.friday/`) | fechada | 2026-11-04 |
| D16 | Carregar o `agile@canary` pelo SDK | **aberta**: depende do spike | — |
| D17 | Fábrica de construção: 3 tarefas agendadas do Claude Code na nuvem por noite, assinatura Max 20x | fechada | 2026-11-04 |
| D18 | Gates humanos: regra de negócio, segurança, estouro de teto e telas | fechada | 2026-11-04 |
| D19 | Painel e workflow (máquina de estados com gates) ficam no escopo | fechada | 2026-11-04 |
| D20 | Tempo do dono: ~1 h/dia para relatório e gates | fechada | 2026-11-04 |

## Siglas
- **API:** Application Programming Interface.
- **CI:** Continuous Integration.
- **QA:** Quality Assurance.
- **SDK:** Software Development Kit.
- **WAL:** Write-Ahead Logging, modo de journal do SQLite.
- **WASM:** WebAssembly.
