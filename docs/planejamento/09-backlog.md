# Backlog v2: TypeScript + Claude Agent SDK (2026-11-04)

Issues para construir a fábrica de `08-roteiro-implementacao.md` (D1 = TypeScript + Claude Agent SDK, decidida pelo usuário em 2026-11-04). A v1 (.NET) está em `_arquivo/09-backlog.v1-dotnet.md`.
Formato: descrição, **critérios de aceite** verificáveis, dependências (Dep.), estimativa (Est.: **P** ≈ 0,5–1 dia, **M** ≈ 1–2, **G** ≈ 3–4 dias de trabalho com apoio de agente [INFERIDO]), fonte e modelo sugerido para o agente que implementa (Mod.). Versões de pacotes: `08` §3.1 [WEB]. Código e identificadores em inglês; camadas de `08` §3.4.
**FHP-001 a FHP-005 podem começar hoje:** não dependem de decisão pendente. A FHP-001 usa a chave de API do Alex por variável de ambiente (nunca gravada em arquivo). Comandos que surgirem vão para `D:\dev\_control-alt-systems\dev-doc-scripts` (convenção do Alex), sem senha ou chave.

## M0. Fundação (7–13 dias)

### FHP-001 Spike: Agent SDK TypeScript numa worktree, com tetos e saída estruturada
Pasta isolada `spikes/agent-sdk` (sem o monorepo): `package.json` com `@anthropic-ai/claude-agent-sdk` e `zod` em versão exata; script `run.ts` que cria uma worktree do `fhp-sandbox` (ou de qualquer repo local) e chama `query()` com `cwd`, `env` mínimo, `tools: ["Read","Glob","Grep"]`, `permissionMode: "dontAsk"`, `maxTurns`, `maxBudgetUsd`, `outputFormat` gerado com `z.toJSONSchema(schema, { target: "draft-7" })`, um hook `PreToolUse` que nega `Write` e uma ferramenta em processo (`createSdkMcpServer` + `tool()`) que só registra a chamada. Rodar com `node run.ts` (type stripping do Node 26).
- [ ] `spike/messages.jsonl` contém `system/init` (lista de ferramentas = `Read`, `Glob`, `Grep`, `mcp__spike__*`, `StructuredOutput`) e o `result` com `total_cost_usd`, `modelUsage`, `num_turns` e `structured_output` que passa no `safeParse`.
- [ ] Rodada com `maxBudgetUsd: 0.01` termina com `subtype: "error_max_budget_usd"`; com `maxTurns: 1`, `error_max_turns` (registrar custo real de cada uma).
- [ ] Pedido explícito para escrever um arquivo é negado pelo hook e aparece como `tool_result` com o motivo.
- [ ] `spike/FINDINGS.md` responde os itens "a confirmar" de `08` §3.2 (1) e (2) e anota as versões do SDK e do Claude Code empacotado.
Dep.: — · Est.: M · Fonte: `08` §3.2, §4.6; [WEB] agent-sdk typescript, structured-outputs, hooks · Mod.: sonnet

### FHP-002 Monorepo `fhp` em TypeScript com CI
Repositório com pnpm workspaces e a estrutura de `08` §3.4; Node 26 (`engines` + `.nvmrc`), TS 6.0 com `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, ESM; Biome; Vitest; dependency-cruiser com as regras de camada; script `pnpm check` = `tsc --noEmit` + `biome ci` + `depcruise` + `vitest run`; GitHub Actions em Windows e Ubuntu; `better-sqlite3` instalado como teste de módulo nativo.
- [ ] `pnpm install --frozen-lockfile && pnpm check` verde no CI nos dois SOs.
- [ ] Import de `packages/application` dentro de `packages/domain` faz o `depcruise` falhar (teste com arquivo de exemplo no CI).
- [ ] Teste abre um banco SQLite em memória via better-sqlite3 no Windows e no Ubuntu.
- [ ] `README.md` com objetivo e links para `08`, `09`, `12`; `NOTICE` reservado.
Dep.: — · Est.: M · Fonte: `08` §3.1, §3.4; RNF13 · Mod.: sonnet

### FHP-003 Repositório `fhp-sandbox` com 3 issues semeadas
Inalterado em relação à v1 (alvo continua .NET, D10): minimal API .NET 10 + xUnit + página Blazor; `AGENTS.md`/`CLAUDE.md` com build/test; issues FHP-S1 (GET /version), FHP-S2 (bug `CalculateTax`), FHP-S3 (FAQ Blazor com i18n pt-BR/en).
- [ ] `dotnet build && dotnet test` verde em < 2 min num clone limpo.
- [ ] Bug de FHP-S2 reproduzido por teste marcado `Skip` com o motivo.
- [ ] As 3 issues existem no GitHub sem critérios de aceite.
Dep.: — · Est.: P · Fonte: `08` §9; `04` §2.2, §2.4, §2.6 · Mod.: sonnet

### FHP-004 Trilha C# → TypeScript (curva de aprendizado)
Documento curto `docs/ts-for-csharp.md` no `fhp` com a tabela de `08` §3.5 aplicada ao projeto, e um exercício: portar para TS um caso de uso pequeno que o Alex já tenha em C# (sugestão: regra de expiração de aprovação), com `Result<T, E>`, união literal no lugar de `enum`, Zod na fronteira e teste Vitest.
- [ ] Exercício com ≥ 5 testes verdes e cobertura de linhas ≥ 90% (`vitest --coverage`).
- [ ] `docs/ts-for-csharp.md` lista ≥ 8 equivalências e as 3 armadilhas encontradas pelo Alex no exercício.
- [ ] Padrões decididos (Result, erros, composition root, nomes de arquivo) registrados em `CONTRIBUTING.md`.
Dep.: — (pode começar antes da FHP-002 numa pasta solta) · Est.: M · Fonte: `08` §3.5; [WEB] TypeScript for Java/C# Programmers · Mod.: sonnet (o Alex escreve, o agente revisa)

### FHP-005 Identidades de bot e proteção de branch no sandbox
Inalterado: contas `fhp-author` e `fhp-judge` (D5), tokens fine-grained só no `fhp-sandbox` (guardados por nome); `main` com PR obrigatório, 1 aprovação, "dismiss stale approvals", "require approval of the most recent reviewable push", sem push direto.
- [ ] Autoaprovação de `fhp-author` é recusada pelo GitHub (resposta registrada).
- [ ] Aprovação de `fhp-judge` libera o merge; push novo derruba a aprovação.
- [ ] Busca automatizada no CI não encontra token em arquivo.
Dep.: FHP-003 · Est.: P · Fonte: `04` §5.1; `10` §1.5; [WEB] protected branches · Mod.: — (manual do Alex) / haiku para o checklist

### FHP-006 Contratos em Zod e validador da fábrica
`packages/contracts`: schemas `.strict()` para `triage`, `criteria`, `workReport`, `qaReport`, `reviewVerdict`, `diagnosis`; geração de `contracts/*.schema.json` (draft-07) com teste de snapshot; `validateContract(kind, value)` = `safeParse` + 7 regras do Felipe.
- [ ] JSON **recusado** do Felipe (`"merge": true`, `"root_cause": "Bug"`, `"evidence": []`, `"risk": "critical"`) devolve as violações das regras 1, 4, 5 e 6.
- [ ] JSON **aceito** do Felipe passa (com `jev_score` opcional).
- [ ] `qaReport` com `verdict: "pass"` e critério sem `how` → `evidence_missing`.
- [ ] `reviewVerdict` exige `headSha` de 40 caracteres hexadecimais e as 5 regras.
- [ ] Schema gerado declara draft-07 e é aceito pelo SDK no spike (FHP-001).
Dep.: FHP-002 · Est.: M · Fonte: `05` §2.4–2.7; `08` §4.7 · Mod.: sonnet

### FHP-007 Máquina de estados da issue (domínio)
`IssueWorkflow` em `packages/domain`: transições de `08` §4.2 como tabela `as const`, guardas puras (rodadas, `headSha`, expiração), `HeldReason` como união literal; erros como `Result`.
- [ ] Teste parametrizado cobre todas as transições permitidas e prova que qualquer outra devolve `InvalidTransition`.
- [ ] Verify com exit ≠ 0 na 3ª rodada → `Held{VerifyRoundsExhausted}`; QA reprovado na 3ª rodada → `Held{QaRoundsExhausted}`; `changes_requested` na 3ª iteração → `Held{ReviewItersExhausted}`.
- [ ] `approve` com `headSha` diferente do PR não sai de `InReview`.
- [ ] `depcruise` confirma zero importações externas em `domain`.
Dep.: FHP-002 · Est.: M · Fonte: `03` A.6, B.1; `05` §2.7, §3.1; diagrama `12` (b) · Mod.: opus

### FHP-008 Inventário do harness-dotnet → plugin por papel
Listar skills, agentes e hooks do harness-dotnet 2.0.1 e decidir o que cada papel carrega via `plugins: [{ type: "local", path }]` (especialista ← tdd; QA ← qa; Judge ← review + `the-judge`; planner ← spec/plan).
- [ ] `docs/skills-map.md` com papel → skill → licença → adaptação.
- [ ] Spike carrega um plugin por caminho e o `system/init` mostra a skill como `plugin:skill`.
- [ ] Skills de terceiros com autor, link e licença no `NOTICE`.
Dep.: FHP-001 · Est.: P · Fonte: `08` §3.2; `10` §1.1; memória do usuário (harness-dotnet) · Mod.: sonnet

## M1. MVP do loop em 1 repositório (24–42 dias)

### FHP-009 Persistência: Drizzle + better-sqlite3
Tabelas de `12` (g); `events` append-only; projeção `issues` reconstruível; WAL; migrações drizzle-kit.
- [ ] Migração inicial aplica num banco vazio; `PRAGMA journal_mode` = `wal`.
- [ ] Apagar a projeção e reconstruir de `events` dá o mesmo resultado (teste).
- [ ] O repositório de eventos não expõe update/delete; trigger SQLite recusa `UPDATE`/`DELETE` em `events` (teste).
- [ ] Índice único em `run_results(run_id, kind)`.
Dep.: FHP-007 · Est.: M · Fonte: `08` §4.3–4.4 · Mod.: sonnet

### FHP-010 Carga do `factory.yaml` e dos agentes + roster check
`yaml` + Zod; mapeamento das fichas para opções do SDK (`08` §4.5).
- [ ] Configuração do sandbox carrega com "0 problems".
- [ ] Estágio sem agente, agente sem estado, ferramenta desconhecida ou segredo com valor → erro com arquivo e linha.
- [ ] `fhp config check` sai com código 1 em configuração inválida.
Dep.: FHP-006 · Est.: M · Fonte: `03` A.5; `05` §3.1 · Mod.: sonnet

### FHP-011 Gerenciador de worktrees
Adaptador `WorktreeManager` com `execa` + git CLI: criar `fhp/<issue>` de `origin/main`, limpar, listar órfãs, checar "limpa e `HEAD` = X".
- [ ] Teste de integração cria, usa e remove worktree num repo temporário (Windows e Ubuntu).
- [ ] `fhp worktrees --orphans` lista worktree sem run ativa.
- [ ] `isClean(head)` detecta arquivo alterado e commit novo.
Dep.: FHP-002 · Est.: P · Fonte: `04` §2.2; G3 · Mod.: sonnet

### FHP-012 Porta `AgentRuntime` e adaptador `ClaudeAgentSdkRuntime`
Monta opções a partir da ficha (`08` §4.6), consome mensagens, confere o `system/init`, mapeia `result` para `RunFinished`, aplica timeout com `AbortController`; `FakeAgentRuntime` para testes.
- [ ] Testes com o fake cobrem `success`, `error_max_budget_usd`, `error_max_turns`, `error_during_execution`, `error_max_structured_output_retries`, `success` sem `structured_output` e timeout, cada um com o `RunFinished.status` certo.
- [ ] Teste de contrato reprocessa `messages.jsonl` gravado na FHP-001 e extrai custo, turnos e saída.
- [ ] `env` passado ao `query()` contém só chaves da lista permitida (teste).
- [ ] `init` com ferramenta fora da ficha → run abortada, `Held{RunMisconfigured}`.
Dep.: FHP-001, FHP-009, FHP-010, FHP-011 · Est.: G · Fonte: `08` §3.2, §4.6; [WEB] typescript, cost-tracking · Mod.: opus

### FHP-013 Política de permissões por papel
`tools` + `allowedTools` + `permissionMode: "dontAsk"` + `PreToolUse` (bash allowlist por glob, caminhos só dentro da worktree com normalização Windows/Linux, nega `git push`, `gh`, `curl` e escrita em `.fhp/**`/`.claude/**`) + `canUseTool` que nega e registra.
- [ ] Tabela de testes (≥ 15 casos) de chamadas permitidas e negadas por papel, incluindo `C:\...\.env` e `../` fora da worktree.
- [ ] QA sem `Edit`/`Write` no `init`; tentativa de `Bash` fora da allowlist vira evento `ToolDenied`.
- [ ] Timeout de hook resulta em chamada bloqueada (teste com hook lento).
Dep.: FHP-012 · Est.: M · Fonte: `04` §3; `07` L05; [WEB] hooks, permissions · Mod.: opus

### FHP-014 Servidor MCP `fhp` em processo
`createSdkMcpServer({ name: "fhp" })` com `criteria_set`, `work_report`, `git_push`, `pr_create`, `qa_report`, `pr_diff`, `review_verdict`, `issue_comment`, `diagnosis_set`; handler por run com os 5 portões de `08` §4.8; efeitos (push, PR, review) via portas `GitHost`/`IssueTracker` com as identidades.
- [ ] Teste por portão: 403, 404, 409, 422 e 200, nessa ordem de verificação.
- [ ] Segundo `qa_report` na mesma run → 409, nenhum evento novo.
- [ ] Recusa volta ao agente como `isError: true` com a lista de violações.
- [ ] Run do QA no sandbox lista só `mcp__fhp__qa_report` e `mcp__fhp__issue_comment` (`strictMcpConfig: true`).
Dep.: FHP-006, FHP-009, FHP-012 · Est.: M · Fonte: `05` §2.5; `04` §2–3; [WEB] agent-sdk typescript (`tool`, `createSdkMcpServer`) · Mod.: opus

### FHP-015 Adaptador GitHub (Octokit)
`octokit` + throttling: intake por label `fhp`, labels de estado e especialista, comentários com prefixo do agente, push pela identidade autora, PR, review pela revisora, merge squash com `sha` esperado.
- [ ] Issue com label `fhp` vira `IssueIngested` em 1 tick (msw).
- [ ] Merge com SHA diferente do head é recusado (msw e manual no sandbox).
- [ ] Comentários começam com `agent:<papel>:`.
Dep.: FHP-005, FHP-009 · Est.: G · Fonte: `04` §5; `05` §2.8 · Mod.: sonnet

### FHP-016 Orquestrador: tick, dispatcher e reconciliação
Tick de 30 s; trava exclusiva de processo; trava por issue; despacho por estado; reconciliação de runs órfãs na partida.
- [ ] Segunda instância não inicia e informa o motivo.
- [ ] Matar o processo no meio de uma run e reiniciar → `canceled_by_reconciliation`, issue em `Held`.
- [ ] Issue com run ativa não recebe segunda run (teste).
Dep.: FHP-012, FHP-014, FHP-015 · Est.: G · Fonte: `03` A.7; `04` §1; RNF06 · Mod.: opus

### FHP-017 API HTTP mínima (Fastify)
`apps/orchestrator`: `/health`, `/approvals` (listar, decidir), base de SSE, esqueleto de webhook com HMAC e janela de tempo; validação com `fastify-type-provider-zod`; logs pino com `redact`.
- [ ] Teste `inject` do Fastify: 401 sem assinatura, 401 com assinatura velha, 200 válido.
- [ ] Segredo nunca aparece no log (teste procura o valor no output).
Dep.: FHP-009 · Est.: M · Fonte: `08` §4.8, §10 · Mod.: sonnet

### FHP-018 Triagem
`haiku`, `outputFormat` com especialista em `enum` + motivo, teto US$ 0,50; comentário no formato do Lode.
- [ ] FHP-S1 e FHP-S2 → `backend`; FHP-S3 → `frontend`, com motivo comentado.
- [ ] Issue já com label de especialista não chama a triagem.
- [ ] Saída inválida → `Held{TriageFailed}`.
Dep.: FHP-012, FHP-015 · Est.: P · Fonte: `04` §2.1; `03` A.7 · Mod.: sonnet

### FHP-019 Etapa de verificação da fábrica
O orquestrador roda `verify.command` na worktree, no SHA enviado.
- [ ] Exit 0 → QA; ≠ 0 → volta ao especialista com saída resumida, contando `verifyRound`; na 3ª falha → `Held{VerifyRoundsExhausted}`.
- [ ] Timeout → `Held{VerifyTimeout}`.
Dep.: FHP-016 · Est.: P · Fonte: `04` §2.5; RF05 · Mod.: sonnet

### FHP-020 Agente especialista backend (.NET)
Ficha + prompt + plugin (tdd do harness-dotnet): critérios (claim + prova), TDD, `work_report` como `structured_output`, `git_push`, `pr_create`.
- [ ] FHP-S1 e FHP-S2 chegam a `QA` com critérios e work report critério a critério.
- [ ] Prompt começa pela 1ª linha vista no Lode, adaptada.
- [ ] `init` mostra só as ferramentas da ficha.
Dep.: FHP-008, FHP-013, FHP-014, FHP-018 · Est.: M · Fonte: `04` §2.2, §2.4; `10` §1.1 · Mod.: opus

### FHP-021 Agente especialista frontend (Blazor)
Igual à FHP-020 para Blazor/MudBlazor; critérios de tela com screenshot.
- [ ] FHP-S3 chega a `QA` com critérios de layout e i18n.
- [ ] Mudança em `screen_paths` sem critério de tela → recusada pelo validador.
Dep.: FHP-020 · Est.: M · Fonte: `04` §2.2; `05` §3.1 · Mod.: opus

### FHP-022 Agente QA
Sem `Edit`/`Write`; sobe o app, roda testes e Playwright; `qa_report`; a fábrica confere worktree limpa e `HEAD` igual.
- [ ] FHP-S3: screenshot por critério de tela; sem screenshot → `evidence_missing`.
- [ ] QA que suja a worktree → relatório descartado, `Held{QaModifiedCode}` (fake).
- [ ] Reprovação volta ao especialista com os critérios reprovados, até 3 rodadas.
Dep.: FHP-019, FHP-021 · Est.: M · Fonte: `04` §2.5; `05` §3.1; `07` L05 · Mod.: opus

### FHP-023 Agente Judge
`opus`; plugin com `the-judge` adaptado (CC-BY-4.0) + 5 regras do Lode; `review_verdict` com `headSha`; review postado por `fhp-judge`.
- [ ] Comentário traz a tabela Rule/Answer/Evidence.
- [ ] Veredito com `headSha` antigo é ignorado (teste).
- [ ] `changes_requested` volta com `findings`, até 3 vezes; depois `Held`.
Dep.: FHP-008, FHP-014 · Est.: M · Fonte: `04` §2.6, §6.4; `05` §2.7 · Mod.: opus

### FHP-024 Gate de aprovação humana, CLI e merge
`ApprovalRequested` com id curto, `headSha`, tier, expiração 30 min; `fhp approvals list|approve|deny <id>` (`node:util` `parseArgs`) chamando a API; merge squash com o SHA aprovado.
- [ ] Aprovar após expirar → recusado, `Held{ApprovalExpired}`.
- [ ] Push novo depois do pedido → aprovação inválida.
- [ ] Decisão grava `human:cli`.
Dep.: FHP-015, FHP-016, FHP-017 · Est.: M · Fonte: `04` §5.2; `05` §3.3; diagrama `12` (e) · Mod.: sonnet

### FHP-025 Risco por regras de caminho
Globs .NET: `**/Migrations/**`, `**/*.csproj`, `Directory.Packages.props`, `.github/**`, `**/appsettings*.json`, `.fhp/**`, `.claude/**`, `CLAUDE.md`, `AGENTS.md`.
- [ ] Um caminho por regra → `high`; diff > 100 KB → `high`; sem casamento → `unclassified`.
- [ ] No M1, qualquer resultado vai ao gate humano (D6).
Dep.: FHP-010 · Est.: P · Fonte: `05` §3.2 · Mod.: sonnet

### FHP-026 Validação ponta a ponta do M1
- [ ] FHP-S1, S2 e S3 chegam a Done sem intervenção fora do gate.
- [ ] `fhp report --milestone M1` gera tabela com custo, tempo, rodadas de QA e Judge por issue.
- [ ] Os 8 critérios do M1 (`08` §5) com link para a evidência.
Dep.: FHP-018 a FHP-025 · Est.: M · Fonte: `08` §9 · Mod.: sonnet

## M2. Limites, breaker e custo (4–8 dias)

### FHP-027 Ledger de custo
Soma `total_cost_usd` por run, issue e dia; `modelUsage` por modelo; custo ausente ou zerado após `error_during_execution` conta como o teto da run (`cost_unknown`).
- [ ] `fhp costs --issue N` = soma dos eventos (diferença 0).
- [ ] Run com custo zerado por falha registra o teto e marca `cost_unknown`.
Dep.: FHP-026 · Est.: M · Fonte: `05` §3.4; [WEB] cost-tracking · Mod.: sonnet

### FHP-028 Tetos por run, issue e dia
- [ ] Teto diário de US$ 0,05 em teste impede nova run (`BudgetExhausted`).
- [ ] Run real com `maxBudgetUsd: 0.05` → `Held{BudgetExceeded}`.
Dep.: FHP-027 · Est.: M · Fonte: `05` §2.3, §2.9; `07` L25 · Mod.: sonnet

### FHP-029 Breaker, interruptor e timeouts
- [ ] Fake com 3 × 429 em 15 min abre o breaker; issues novas vão a `Held{BreakerOpen}`.
- [ ] `enabled: false` → nenhuma run começa e o intake responde "disabled".
Dep.: FHP-027 · Est.: M · Fonte: `05` §2.1–2.3; diagrama `12` (f) · Mod.: sonnet

### FHP-030 OpenTelemetry, logs e conciliação
Span por run com `fhp.issue`, `fhp.agent`, `fhp.cost_usd`, `fhp.tokens`; OTLP configurável; `fhp costs --by stage --month`; conciliação com a Usage and Cost API.
- [ ] Span exportado contém os 4 atributos (exportador em memória no teste).
- [ ] Relatório mensal mostra diferença ledger × fatura em US$ e %.
Dep.: FHP-027 · Est.: M · Fonte: `06` §2; [WEB] cost-tracking · Mod.: sonnet

## M3. Risco, merge, Slack e VPS (7–12 dias)

### FHP-031 Classificador de risco com modelo
- [ ] Golden set de 10 diffs com ≥ 9 acertos; nenhum `high` virou `low`; dúvida → `high`.
Dep.: FHP-025 · Est.: M · Fonte: `05` §3.2 · Mod.: sonnet

### FHP-032 Auto-merge para risco low (flag)
- [ ] Flag desligada: todo merge pede aprovação; ligada: `low` faz merge e `high` pede.
Dep.: FHP-031 · Est.: P · Fonte: D6 · Mod.: sonnet

### FHP-033 Aprovação pelo Slack (`@slack/bolt`)
- [ ] Mensagem com todos os campos do pedido visto no Lode e botões Approve/Deny.
- [ ] Assinatura inválida → 401; clique após expirar → recusado.
Dep.: FHP-024, FHP-034 · Est.: M · Fonte: `04` §5.2; `05` §3.3 · Mod.: sonnet

### FHP-034 VPS Linux com contêiner por run
Imagem `node:26-slim`; systemd ou docker compose; proxy TLS; contêiner por run via `spawnClaudeCodeProcess` ou `sandbox` (confirmar qual, `08` §3.2).
- [ ] `systemctl restart` não perde estado.
- [ ] Run no contêiner não lê arquivo fora da worktree nem acessa host fora da lista (teste).
- [ ] `FINDINGS.md` registra o mecanismo escolhido e por quê.
Dep.: FHP-029 · Est.: G · Fonte: D3; `06` §4.1; [WEB] agent-sdk typescript · Mod.: sonnet

### FHP-035 Backup e restauração do SQLite
- [ ] Backup diário via `db.backup()`; restauração num diretório limpo reconstrói a projeção igual (teste).
Dep.: FHP-034 · Est.: P · Fonte: D9 · Mod.: sonnet

### FHP-036 Piloto real no Toolbox
- [ ] 1 issue pequena escolhida pelo Alex chega a Done; relatório com as métricas de `08` §9.
Dep.: FHP-032, FHP-034 · Est.: M · Fonte: D10 · Mod.: sonnet

## M4. Painel React (8–13 dias)

### FHP-037 Trilha React para o Alex
- [ ] Protótipo de 1 tela (lista de issues da API) com TanStack Query e teste de componente; notas Blazor → React em `docs/`.
Dep.: FHP-017 · Est.: P · Fonte: `08` §3.5, D13 · Mod.: sonnet

### FHP-038 Board e Needs you
`apps/web` (React 19 + Vite 8), servida pela API; toda ação passa pela API.
- [ ] Testes de componente das colunas e botões; aprovação exige confirmação.
Dep.: FHP-026, FHP-037 · Est.: G · Fonte: `06` §4.1; `04` §2.3 · Mod.: sonnet

### FHP-039 Run ao vivo (SSE)
- [ ] Evento gravado aparece na timeline em < 2 s (integração); botão Pausar aborta a run → `Held`.
Dep.: FHP-038 · Est.: M · Fonte: `06` §4.1 · Mod.: sonnet

### FHP-040 Quality
- [ ] Custo por PR mesclado, aprovação do Judge na 1ª rodada, rodadas de QA e tempo por estágio batem com `fhp report` no mesmo período.
Dep.: FHP-030, FHP-038 · Est.: M · Fonte: `05` §3.6 · Mod.: sonnet

### FHP-041 Visão do workflow
- [ ] Mostra estágios, agentes e os mesmos problemas de `fhp config check`; e2e Playwright do fluxo aprovar.
Dep.: FHP-010, FHP-038 · Est.: P · Fonte: `03` A.1 · Mod.: haiku

## M5. Intake de erros e Diagnose (3–5 dias)

### FHP-042 Intake de monitores com guardas
- [ ] Mesmo erro 2 vezes → 1 issue; 11º sinal na hora → descartado sem modelo; webhook sem HMAC → 401.
Dep.: FHP-029 · Est.: M · Fonte: `05` §2.2; `04` §2.8 · Mod.: sonnet

### FHP-043 Classificador ruído/sinal
- [ ] `haiku` com `enum noise|signal`: ≥ 8/10 acertos; modelo indisponível → issue aberta (falha aberta, como o Felipe).
Dep.: FHP-042 · Est.: P · Fonte: `05` §2.2; `07` L09 · Mod.: sonnet

### FHP-044 Agente diagnose e liberação por confiança
- [ ] Só leitura no `init`; evidência sem `path` nem `url` → recusada; `medium` → `Held{ConfidenceBelowHigh}`; dados externos delimitados.
Dep.: FHP-042 · Est.: M · Fonte: `04` §2.3; `03` A.8 · Mod.: opus

## M6. Pós-merge e revert (5–8 dias)

### FHP-045 Deploy Record e DeployGate
- [ ] Callback assinado do GitHub Actions; SHA diferente → incidente; sucesso → `Observing`.
Dep.: FHP-034 · Est.: G · Fonte: `05` §2.8; `03` A.4 · Mod.: sonnet

### FHP-046 Janela de medição e last-good-sha
- [ ] Limiar violado em teste → incidente; `last-good-sha` só muda com `passed: true`.
Dep.: FHP-045 · Est.: M · Fonte: `05` §2.8 · Mod.: sonnet

### FHP-047 Incidente → Revert por clique (agente reverter)
- [ ] PR de revert passa pelos mesmos gates; sem clique, nada é revertido.
Dep.: FHP-044, FHP-046 · Est.: M · Fonte: `03` A.4; D11; diagrama `12` (j) · Mod.: opus

## M7. Severidade, planner e evals (3–5 dias)

### FHP-048 Modelo por severidade
- [ ] `RunStarted.model` = opus para issue `high`, sonnet para `low`.
Dep.: FHP-018 · Est.: P · Fonte: `05` §5 [FALA 80:33] · Mod.: sonnet

### FHP-049 Planner e Missões
- [ ] Spec de exemplo do harness-dotnet gera ≥ 3 issues `fhp` com critérios de entrada e dependências.
Dep.: FHP-008, FHP-026 · Est.: M · Fonte: `06` §4.1; `04` §2.7 · Mod.: opus

### FHP-050 Golden set e avaliação
- [ ] `fhp eval` produz taxa de Done, custo médio e rodadas; regressão bloqueia troca de prompt.
Dep.: FHP-026 · Est.: M · Fonte: `06` §2; `10` §1.1 · Mod.: sonnet

## M8 (opcional)
| Id | Título | Dep. | Est. | Fonte |
|---|---|---|---|---|
| FHP-051 | Adaptador Linear for Agents | FHP-026 | G | `10` §1.5 |
| FHP-052 | Teammate Hermes no Slack para intake | FHP-033 | G | `06` §1; `10` §2 |
| FHP-053 | Brain (Unblocked MCP ou `AGENTS.md` enriquecido) | FHP-026 | M | `06` §2; `10` §2 |

## Resumo por marco
| Marco | Issues | Soma (P/M/G) | Dias (soma) | Dias com folga de curva |
|---|---|---|---|---|
| M0 | 001–008 | 3 P, 5 M | 6,5–13 | **7–13** |
| M1 | 009–026 | 4 P, 11 M, 3 G | 22–38 | **24–42** (+2–4) |
| M2 | 027–030 | 4 M | 4–8 | **4–8** |
| M3 | 031–036 | 2 P, 3 M, 1 G | 7–12 | **7–12** |
| M4 | 037–041 | 2 P, 2 M, 1 G | 6–10 | **8–13** (+2–3 React) |
| M5 | 042–044 | 1 P, 2 M | 2,5–5 | **3–5** |
| M6 | 045–047 | 2 M, 1 G | 5–8 | **5–8** |
| M7 | 048–050 | 1 P, 2 M | 2,5–5 | **3–5** |
| **Total M0–M7** | 50 | | | **61–106** (núcleo M0–M2: 35–63) |

## Siglas
- **API:** interface de programação. **CI:** integração contínua. **CLI:** linha de comando. **CC-BY-4.0:** licença com atribuição. **e2e:** ponta a ponta. **HMAC:** assinatura com chave secreta. **HTTP:** protocolo web. **i18n:** internacionalização. **JSON / YAML:** formatos de dados e configuração. **MCP:** Model Context Protocol. **OTLP:** protocolo do OpenTelemetry. **PR:** pull request. **QA:** garantia de qualidade. **SDK:** kit de desenvolvimento. **SHA:** identificador do commit. **SO:** sistema operacional. **SSE:** Server-Sent Events. **TDD:** desenvolvimento guiado por testes. **TLS:** criptografia de transporte. **TS:** TypeScript. **VPS:** servidor virtual privado. **WAL:** modo de journal do SQLite.
- **FHP-nnn:** issue deste backlog; **FHP-S1…S3:** issues semeadas no `fhp-sandbox`. **M0…M8:** marcos; **D1…D13:** decisões (`08` §0).
