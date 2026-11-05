# Decisões vigentes

Fonte única das decisões em vigor. O histórico e o raciocínio estão em `planning/08-implementation-roadmap.md` §0 e `planning/13-second-opinion.md`. Quando uma decisão muda, a linha é atualizada aqui no mesmo commit.

> Duas coisas diferentes: a **fábrica que constrói o Friday** (sessões agendadas na nuvem, hoje) e o **Friday como produto** (o orquestrador TypeScript, que um dia substitui essas sessões). As decisões marcadas *produto* valem para o código do Friday.

| Id | Decisão | Estado | Data |
|---|---|---|---|
| D1 | Orquestrador em TypeScript + Claude Agent SDK (*produto*) | fechada | 2026-11-04 |
| D2 | GitHub Issues + GitHub Project como tracker; estado espelhado por labels `status:*` | fechada | 2026-11-04 |
| D4 | Credencial do Friday produto: chave de API; a assinatura é tratada como bônus instável | fechada | 2026-11-04 |
| D6′ | Merge automático em `develop` do que a IA validou (CI + QA + Judge), exceto com gate | fechada | 2026-11-04 |
| D8 | Modelos por papel: Haiku relatório, Sonnet refinar/implementar/QA/Judge, Opus só no Judge com gate ou risco ≥ medium | fechada | 2026-11-04 |
| D9 | SQLite (better-sqlite3) + Drizzle, WAL, um processo escritor (*produto*) | fechada | 2026-11-04 |
| D13 | Painel: Blazor WASM + cliente C# gerado do OpenAPI (*produto*) | fechada | 2026-11-04 |
| D14 | Multi-projeto com `project_id` desde o início; política de segurança fora do repositório do projeto (*produto*) | fechada | 2026-11-04 |
| D15 | Nome `friday` em tudo (label, CLI, `mcp__friday__*`, `.friday/`) | fechada | 2026-11-04 |
| D16 | Carregar o `agile@canary` pelo SDK | **aberta**: depende do spike #10 | — |
| D17 | Fábrica de construção: 3 tarefas agendadas do Claude Code na nuvem por noite, assinatura Max 20x | fechada | 2026-11-04 |
| D18 | Gates humanos: regra de negócio, segurança, estouro de teto e telas | fechada | 2026-11-04 |
| D19 | Painel e workflow (máquina de estados com gates) ficam no escopo | fechada | 2026-11-04 |
| D20 | Tempo do dono: ~1 h/dia para relatório e gates | fechada | 2026-11-04 |
| D21 | Idioma híbrido: código, variáveis, nomes de arquivo, branches e testes em inglês; commits, PRs, issues, comentários, relatórios, docs, textos de tela e conversas em pt-BR | fechada | 2026-11-04 |
| D22 | Um motor (Friday) e pacotes de método (`agile`, `lens`) como dado; estados do motor fixos, fases plugáveis dentro do `in_progress`; a execução dos plugins é aposentada depois de 4–8 semanas de uso real do Friday ([`method-packs.md`](method-packs.md)) | proposta; confirmar no go/no-go | 2026-11-04 |
| D23 | Contratos Zod em `packages/contracts`; `domain` sem dependências externas; `application` importa `domain` e `contracts` | fechada | 2026-11-04 |
| D24 | A #12 entrega `qaReport`, `reviewVerdict` e o validador; os outros contratos e o JSON Schema vão para a #29, a carga do `factory.yaml` para a #30, o evento de transição para a #13 e o resultado de run para a #16 | fechada | 2026-11-04 |
| D25 | A #8 fica só em Ubuntu; a #14 acrescenta um job separado em Windows para o `better-sqlite3`, sem mudar o check obrigatório `check` | fechada | 2026-11-04 |
| D26 | A rodada real do spike é a `owner-action` #31, com teto de 10 turnos e 0,5 USD na rodada normal; a #9 entrega o código testado sem chave | fechada | 2026-11-04 |
| D27 | `develop` protegida pelo ruleset `develop-protection`, com GitHub Pro: check obrigatório `check`, só PR com squash, sem force-push nem exclusão | fechada | 2026-11-04 |
| D28 | Tarefa noturna A ficou desligada de 04/11 a 05/11, até vermos o resultado da #8; religada pelo dono em 05/11, com primeira execução às 23:41 UTC, sem revisão independente à noite. As três tarefas estão ligadas | fechada | 2026-11-05 |
| D29 | A máquina de estados da #13 usa os estados de `planning/12-target-diagrams.md` (b.1), mais `Canceled` e a saída `Held` → `InProgress` de (b.2); `Diagnose`, `Observing` e `Reverting` ficam para M5 e M6 | fechada | 2026-11-04 |
| D30 | `StateChanged` é um tipo TypeScript em `@friday/domain`, com `type`, `issueId`, `from`, `to`, `trigger` e `heldReason`, sem Zod; `seq`, `runId`, `actor` e data ficam no envelope gravado pela #14 | fechada | 2026-11-04 |
| D31 | O verify volta a `InProgress` até a 3ª falha, que leva a `Held{VerifyRoundsExhausted}`; mesmo teto de QA e Judge | fechada | 2026-11-04 |
| D32 | `RunHeld` vale em `Triage`, `InProgress`, `Verify`, `QA` e `InReview` | fechada | 2026-11-04 |
| D33 | Ao sair de `Held` com `Resumed`, só o contador do motivo esgotado é zerado; toda volta a `InProgress` recomeça da primeira fase do pacote | fechada | 2026-11-04 |
| D34 | Formas dos contratos da #29: `triage` = `specialist` (backend, database, frontend, infra, security) + `reason`; `criteria` = lista de `index`, `claim` e `proof` tipada (`command` ou `browser`); `workReport` = `summary`, `headSha`, `changedFiles`, `notDone`; `diagnosis` = forma do Felipe, e os campos do Lode entram em M5 | fechada | 2026-11-04 |
| D35 | `factory.yaml` e fichas de agente da #30 ficam inteiros no registro central do Friday, fora do repositório alvo, cumprindo D14 e R4; a carga recebe a pasta por `--root`, e a pasta final e a proibição de ler da worktree ficam com a #17. Prevalece sobre o `.fhp/` no repositório alvo de `planning/08-implementation-roadmap.md` §4.5 | fechada | 2026-11-04 |
| D36 | Chaves do projeto no `factory.yaml`: `schemaVersion` (`friday/v1`), `enabled`, `repository`, `verify`, `flow` (`screen_paths`, `pr_evidence`, `triage`), `risk`, `pull_requests`, `limits` e `secrets`; saem os estados de `flow` e os tetos de rodada, fixos no motor (D29, D31) | fechada | 2026-11-04 |
| D37 | Roster check: ao menos um agente em `InProgress`, `QA` e `InReview`; `states` aceita só esses três; os 5 especialistas da triagem precisam de ficha com `InProgress` | fechada | 2026-11-04 |
| D38 | Ferramentas aceitas numa ficha de agente: `Read`, `Glob`, `Grep`, `Bash`, `Edit` e `Write`, mais as 8 ferramentas MCP da #43; `WebFetch` e `WebSearch` ficam de fora | fechada | 2026-11-04 |
| D39 | A tarefa C lê o `- risco:` da issue para escolher o Judge. Sem essa linha, usa `judge-strong`, o que amplia a D8. Se o `judge` devolver risco maior que o declarado, repete com `judge-strong` no mesmo `head_sha`, e esse veredito passa a valer; risco menor não muda nada | fechada | 2026-11-05 |
| D40 | `RunFinished` da #16 fica em `packages/contracts`, fora de `ContractKind`, com `status`, `subtype`, `model`, `costUsd`, `tokens`, `numTurns`, `durationMs`, `output` e `violations`; custo, tokens, turnos e duração são `null` quando não há mensagem `result`. Amplia `RunFinished{status, costUsd, tokens, subtype}` de `planning/08-implementation-roadmap.md` §4.3 (*produto*) | fechada | 2026-11-05 |
| D41 | O adaptador do Agent SDK usa `settingSources: []`: nenhuma configuração é lida da worktree, por R4. As regras do agente vêm do `prompt_file` do registro central, e o `CLAUDE.md` do projeto só é lido como texto. Prevalece sobre `["project"]` de `planning/08-implementation-roadmap.md` §4.6 (*produto*) | fechada | 2026-11-05 |
| D42 | O teste real do adaptador com chave de API fica pulado sem `FRIDAY_LIVE=1`. Quem o executa é uma issue `owner-action` criada a partir da #16, que não trava as issues seguintes (*produto*) | fechada | 2026-11-05 |
| D43 | O adaptador passa ao SDK o apelido de modelo da ficha (`haiku`, `sonnet`, `opus`), sem tabela de ids. A versão do SDK é fixa, e `RunFinished.model` registra o modelo real (*produto*) | fechada | 2026-11-05 |

## Siglas
- **API:** Application Programming Interface.
- **CI:** Continuous Integration.
- **MCP:** Model Context Protocol.
- **QA:** Quality Assurance.
- **R4:** risco 4 da segunda opinião (`planning/13-second-opinion.md`).
- **SDK:** Software Development Kit.
- **WAL:** Write-Ahead Logging, modo de journal do SQLite.
- **WASM:** WebAssembly.
