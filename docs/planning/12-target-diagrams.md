# Diagramas da arquitetura alvo (TypeScript, 2026-11-04, revisados na S8)

Diagramas **mermaid** da fábrica `fhp` na versão TypeScript + Claude Agent SDK (D1 decidida em 2026-11-04). Cada diagrama indica a seção de origem em `08-implementation-roadmap.md` e, quando houver, em `05`, `03`, `04` e `09`. Nomes de pacotes e APIs estão verificados em `08` §3 `[WEB]`; o que não tem fonte é proposta deste roteiro **[DECIDIR]**.

**Revisão S8 (2026-11-04, frente B):** conferidos contra `08` §4 e §10, `05`, `03`, `04` e `09` (relatório em `sessoes/saida/S8b-revisao-alvo.md`). Mudanças: (b) dividido em (b.1) e (b.2), com `verifyRound`, `Merging → Held`, entrada de monitor e catálogo de `heldReason`; (d) mostra a ausência do portão Bearer 401 e separa 403/404; (e) dividido em (e.1) e (e.2); (f) passa a começar depois das guardas de (k); (i) reorganizado em colunas; novos (k.1), (k.2), (l) e (m). Os ids (a) a (j) continuam os mesmos; sub-ids `.1`/`.2` marcam divisões. Toda a sintaxe foi validada com `@mermaid-js/mermaid-cli` (`mmdc`) em 2026-11-04; alvo de legibilidade: 300 a 1600 px de altura a 1228 px de largura.

## (a) Componentes e contêineres
Origem: `08` §4.1. Um único processo Node (`apps/orchestrator`) contém o tick, o executor de agentes (Agent SDK), o servidor MCP `fhp` **em processo** e a API HTTP. O agente (binário do Claude Code iniciado pelo SDK) só enxerga a worktree e as ferramentas `mcp__fhp__*`; credenciais do GitHub ficam no processo do orquestrador. Sem mudança na S8.

```mermaid
flowchart LR
  subgraph Host["Host: PC do Alex em M0-M2, VPS Linux a partir de M3"]
    subgraph Proc["Processo Node 26: apps/orchestrator"]
      TICK["Tick 30 s e máquina de estados"]
      RUNNER["ClaudeAgentSdkRuntime: query()"]
      MCP["MCP fhp em processo: createSdkMcpServer"]
      HOOKS["Hooks PreToolUse e canUseTool"]
      API["API HTTP Fastify: aprovações, webhooks, SSE"]
      LEDGER["Ledger, tetos e breaker"]
    end
    CC["Binário Claude Code, filho do SDK"]
    WT["git worktrees fhp/issue"]
    DB[("SQLite WAL via Drizzle")]
    CLI["CLI fhp"]
    WEB["Painel React + Vite, M4"]
  end
  CFG[".fhp/factory.yaml e .fhp/agents no repo alvo"]
  GH["GitHub: Issues, PRs, branch protection"]
  ANT["API Anthropic"]
  SL["Slack, M3"]
  MON["Monitores, M5"]
  TICK --> RUNNER
  RUNNER --> CC
  CC --> WT
  CC --> ANT
  CC -- "chamadas mcp__fhp__*" --> MCP
  CC -- "cada chamada de ferramenta" --> HOOKS
  MCP --> DB
  TICK --> DB
  LEDGER --> DB
  TICK -- "fhp-author e fhp-judge" --> GH
  TICK --> CFG
  CLI --> API
  WEB --> API
  SL --> API
  MON --> API
  API --> DB
```

## (b.1) Máquina de estados da issue: caminho principal
Origem: `08` §4.2 e §4.9 (gates G0 a G7); `05` §2.7, §2.9, §3.1; `09` FHP-007, FHP-018, FHP-019, FHP-022 a FHP-024. Nomes do Lode `[VISTO 66:30]` (`03` A.6) mais estados técnicos nossos. `Held` concentra todo "precisa de você", sempre com `heldReason` (catálogo abaixo). **Todos os nós `Held` são o mesmo estado**; aparecem repetidos só para não cruzar setas. Os três laços de volta a `InProgress` (verify, QA e Judge) têm teto 3: `verifyRound` é novo na S8 **[DECIDIR o teto]**, `qaRound` vem de `flow.max_qa_rounds` `[VISTO 65:25]` e `reviewIter` de `iter < 3` `[VISTO 52:00]`. `unclassified` existe só em M1–M2, sem modelo de risco (FHP-025).

```mermaid
stateDiagram-v2
  direction TB
  state "Held" as H0
  state "Held" as H1
  state "Held" as H2
  state "Held" as H3
  state "Held" as H4
  state "Held" as H5
  [*] --> Backlog: pessoa cria issue
  Backlog --> Todo: label fhp, passa por G0
  Todo --> Triage: sem label de especialista
  Todo --> InProgress: com label
  Triage --> InProgress: especialista escolhido
  Triage --> H1: TriageFailed
  InProgress --> Verify: G1 work report e push
  InProgress --> H0: estouro, falha ou pausa
  Verify --> QA: G2 exit 0
  Verify --> InProgress: exit não 0 e verifyRound menor que 3
  Verify --> H2: VerifyRoundsExhausted ou VerifyTimeout
  QA --> InReview: G3 pass com evidência
  QA --> InProgress: fail e qaRound menor que 3
  QA --> H2: QaRoundsExhausted ou QaModifiedCode
  InReview --> RiskCheck: G4 approve e headSha igual ao PR
  InReview --> InProgress: changes_requested e reviewIter menor que 3
  InReview --> H3: ReviewRejected ou ReviewItersExhausted
  RiskCheck --> AwaitingApproval: G5 high, unclassified ou auto-merge off
  RiskCheck --> Merging: low e auto-merge on, M3+
  AwaitingApproval --> Merging: G6 aprovado com o mesmo head
  AwaitingApproval --> H4: ApprovalDenied, ApprovalExpired ou HeadChanged
  Merging --> Done: G7 squash com SHA exato
  Merging --> H5: MergeBlocked
```

## (b.2) Máquina de estados: Held, Diagnose e pós-merge
Origem: `08` §5 M5 e M6, D11; `03` A.8; `04` §2.3, §2.8; `09` FHP-044 a FHP-047. Monitor cria a issue em `Diagnose` (como `create_state Diagnose` do `sentry-watch` `[VISTO 68:25]`); confiança `medium` fica retida para uma pessoa `[VISTO 70:20, 70:40]`. No pós-merge, nada é revertido sem clique `[VISTO 71:30]`: o incidente diagnosticado espera em `Held{IncidentOpen}` **[DECIDIR o nome]**. O reverter abre o PR de revert, que entra em `Verify` e segue os mesmos gates G2 a G7 de (b.1).

```mermaid
stateDiagram-v2
  direction TB
  state "Verify, segue (b.1)" as V
  state "InProgress, segue (b.1)" as IP
  [*] --> Diagnose: monitor abre issue, M5, guardas em (k)
  Diagnose --> IP: origem monitor e confiança high
  Diagnose --> Held: medium ou low, ConfidenceBelowHigh
  Done --> Observing: deploy ok e deployed_sha igual ao merge, M6
  Done --> Diagnose: deployed_sha diferente, incidente
  Observing --> Diagnose: limiar violado na janela de 30 min
  Observing --> [*]: janela limpa, grava last-good-sha
  Diagnose --> Held: incidente pós-merge, IncidentOpen
  Held --> IP: pessoa decide, põe label e move
  Held --> Reverting: pessoa clica Revert
  Held --> Canceled: pessoa rejeita
  Reverting --> V: reverter abre PR de revert
  Canceled --> [*]
```

## Catálogo de heldReason
Origem: diagramas (b.1), (b.2), (d), (e.2), (f); `09`. Nomes sem fonte em `08`/`09` estão marcados **[DECIDIR]**.

| heldReason | Onde nasce | Fonte |
|---|---|---|
| `TriageFailed` | Triage com saída inválida | FHP-018 |
| `RunMisconfigured` | `system/init` diverge da ficha | `08` §4.6; FHP-012 |
| `BudgetExceeded`, `TurnsExceeded` | run termina com `error_max_budget_usd` / `error_max_turns` | (f); FHP-028 |
| `RuntimeFailed` | timeout, 5xx ou 429 sem abrir o breaker | (f) |
| `BreakerOpen` | despacho com breaker aberto | (f); FHP-029 |
| `BudgetExhausted` | teto diário | (f); FHP-028 |
| `IssueBudgetExceeded` | teto por issue (`08` §4.10, US$ 5,00) | (f) **[DECIDIR o nome]** |
| `SchemaInvalid` | `structured_output` recusado (422) | (d); literal do Felipe `[VISTO 49:28]` **[DECIDIR o nome]** |
| `VerifyRoundsExhausted` | 3ª falha do verify | (b.1) **[DECIDIR]**, novo na S8 |
| `VerifyTimeout` | verify estoura o tempo | FHP-019 |
| `QaRoundsExhausted` | QA reprovado na 3ª rodada | FHP-007 |
| `QaModifiedCode` | QA sujou a worktree ou mudou `HEAD` | FHP-022; `08` §5 M1 |
| `ReviewItersExhausted` | `changes_requested` na 3ª iteração | FHP-007 |
| `ReviewRejected` | Judge devolve `reject` | (b.1) **[DECIDIR o nome]** |
| `ApprovalDenied`, `ApprovalExpired`, `HeadChanged` | gate humano | (e.2); FHP-024 |
| `MergeBlocked` | branch protection recusa o merge | (e.2) |
| `ConfidenceBelowHigh` | diagnose `medium` ou `low` | FHP-044 |
| `IncidentOpen` | incidente pós-merge diagnosticado | (b.2) **[DECIDIR o nome]** |
| `Reconciled` | run órfã na partida (`canceled_by_reconciliation`) | FHP-016 **[DECIDIR o nome]** |
| `PausedByHuman` | botão Pausar do painel | FHP-039 **[DECIDIR o nome]** |
| `SpecialistWithoutAgent` | triagem escolhe especialista sem ficha | D84; #318 |

## (c) Sequência de uma execução completa
Origem: `08` §4.6–4.9. Uma run de especialista seguida de verify, QA e Judge, até o gate humano. Os agentes nunca falam com o GitHub: as ferramentas `fhp` executam dentro do orquestrador, que usa as identidades de bot. Sem mudança na S8.

```mermaid
sequenceDiagram
  autonumber
  participant O as Orquestrador
  participant W as Worktree
  participant S as Agent SDK query
  participant F as MCP fhp em processo
  participant G as GitHub
  participant J as Judge, outra run
  participant H as Pessoa
  O->>W: git worktree add fhp/42 a partir de origin/main
  O->>S: query com cwd, tools, hooks, mcpServers, maxTurns, maxBudgetUsd, outputFormat
  S->>F: criteria_set com critérios e provas
  F-->>S: aceito, critérios gravados
  S->>W: edita código e roda testes
  S->>F: git_push
  F->>G: push com identidade fhp-author
  S->>F: pr_create
  F->>G: abre PR
  S-->>O: result success com structured_output work_report e total_cost_usd
  O->>W: roda verify.command no SHA enviado
  O->>S: nova query do QA, sem Edit e Write
  S->>F: qa_report pass com evidência
  O->>O: confere worktree limpa e HEAD inalterado
  O->>J: query do Judge em opus
  J->>F: review_verdict approve com head_sha
  F->>G: review postado por fhp-judge
  O->>O: classifica risco
  O->>H: pedido de aprovação com id, head, tier e expiração
  H->>O: fhp approvals approve id
  O->>G: merge squash com SHA esperado
```

## (d) Validação do contrato
Origem: `08` §4.7–4.8; `05` §2.5–2.6; `09` FHP-006, FHP-014. Duas camadas: o SDK valida a forma (JSON Schema draft-07 gerado do Zod) e o validador da fábrica aplica o schema Zod completo e as 7 regras do Felipe `[VISTO 49:28]`. Ordem dos portões igual à da FHP-014: 403, 404, 409, 422, 200. **Portão 1 (Bearer, 401) não existe nas ferramentas `fhp`: decisão nossa** (`08` §4.8). O que substitui a autenticação: o handler é criado por run (closure com `runId` e papel) e só existe dentro do processo; `allowedTools` e `strictMcpConfig: true` limitam a run às ferramentas `mcp__fhp__*` da ficha; o agente não recebe token algum. O 401 continua nos endpoints HTTP externos, ver (k.1) e (k.2). Recusa nunca dispara retry cego; os laços de volta ao especialista estão em (b.1).

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 330}}}%%
flowchart TD
  P1["Sem o portão 1 do Felipe, Bearer 401: o handler é criado por run, closure com runId e papel, e só existe no processo. 401 fica nos endpoints HTTP externos, ver (k)"]
  IN["Saída do agente: mcp__fhp__* ou structured_output"] --> G2(["Ferramenta na ficha do papel e estado permite?"])
  P1 -.- IN
  G2 -- não --> R403["403 ResultRejected"]
  G2 -- sim --> G3(["Run ativa e não cancelada?"])
  G3 -- não --> R404["404 ResultRejected"]
  G3 -- sim --> G4(["Resultado desse tipo ainda não aceito nesta run?"])
  G4 -- não --> R409["409, replay não faz nada"]
  G4 -- sim --> G5(["Zod safeParse e 7 regras ok?"])
  G5 -- não --> R422["422 SchemaInvalid"]
  G5 -- sim --> OK["200: grava evento, marca uso, aplica efeito; próximo estado em (b.1)"]
  R422 --> TOOL(["Veio por ferramenta MCP?"])
  TOOL -- sim --> ERR["isError ao agente com as violações; run segue nos mesmos tetos"]
  TOOL -- não --> HELD["Held SchemaInvalid"]
```

## (e.1) Classificação de risco antes do merge
Origem: `08` §4.9 (G4, G5) e D6; `05` §3.2; `09` FHP-025, FHP-031, FHP-032. Sem regra casando, o modelo lê o diff (M3+); em M1–M2 não há modelo e o resultado é `unclassified`, que vai ao gate humano.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 260}}}%%
flowchart TD
  A["Judge approve"] --> B(["G4: headSha do veredito igual ao head do PR?"])
  B -- não --> X1["Ignora veredito, fica em InReview"]
  B -- sim --> C(["G5: regra de caminho ou diff maior que 100 KB?"])
  C -- sim --> HIGH["high"]
  C -- não --> M(["Modelo classifica o diff, M3+"])
  C -- "não, M1-M2" --> UNC["unclassified"]
  M -- "high ou dúvida" --> HIGH
  M -- low --> LOW["low"]
  LOW --> F(["Auto-merge ligado? flag D6, M3+"])
  F -- sim --> MERGE["Merge direto, segue (e.2)"]
  F -- não --> REQ["Pedido de aprovação, segue (e.2)"]
  HIGH --> REQ
  UNC --> REQ
```

## (e.2) Aprovação ligada ao commit e merge
Origem: `08` §4.9 (G6, G7) e §10; `05` §3.3; `09` FHP-024. A aprovação grava o `headSha`; qualquer push depois dela invalida o pedido, e o GitHub reforça com "dismiss stale approvals" `[WEB]`. Expiração de 30 min como no Lode `[VISTO 68:45, INFERIDO o prazo]`.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 260}}}%%
flowchart TD
  REQ["G6: ApprovalRequested com id, headSha, tier e expiresAt, 30 min"] --> D(["Pessoa decide antes de expirar?"])
  D -- não --> HX["Held ApprovalExpired"]
  D -- nega --> HN["Held ApprovalDenied"]
  D -- aprova --> E(["Head atual igual ao aprovado?"])
  E -- não --> HS["Held HeadChanged"]
  E -- sim --> MERGE["Merge squash com SHA exato"]
  LOW["low com auto-merge, de (e.1)"] --> MERGE
  MERGE --> P(["G7: branch protection aceita? review válido de fhp-judge"])
  P -- não --> HB["Held MergeBlocked"]
  P -- sim --> DONE["Done, comentário com o commit"]
```

## (f) Orçamento e breaker
Origem: `08` §4.10; `05` §2.3; `09` FHP-027 a FHP-029. Começa depois das guardas de despacho de (k.2) (interruptor e trava da issue). `maxBudgetUsd` do SDK é estimativa do cliente `[WEB]`; o ledger da fábrica é o controle final e conta custo desconhecido como o teto da run.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 260}}}%%
flowchart TD
  S["Despacho passou pelas guardas de (k): enabled e trava da issue"] --> BR(["Breaker fechado?"])
  BR -- não --> HB["Held BreakerOpen"]
  BR -- sim --> DAY(["Gasto do dia mais teto da run cabe no per_day_usd?"])
  DAY -- não --> HD["Held BudgetExhausted"]
  DAY -- sim --> ISS(["Gasto da issue mais teto da run cabe no per_issue_usd?"])
  ISS -- não --> HI["Held IssueBudgetExceeded"]
  ISS -- sim --> RUN["query com maxBudgetUsd, maxTurns e AbortController com timeout"]
  RUN --> RES(["Resultado da run"])
  RES -- success --> LED["Ledger soma total_cost_usd"]
  RES -- "sem custo informado" --> UNK["Ledger registra o teto e marca cost_unknown"]
  RES -- "error_max_budget_usd ou error_max_turns" --> HR["Held BudgetExceeded ou TurnsExceeded"]
  RES -- "structured_output inválido ou ausente" --> HS["Held SchemaInvalid, ver (d)"]
  RES -- "timeout, 5xx ou 429" --> FAIL["Conta falha de runtime"]
  FAIL --> TH(["3 falhas em 15 min?"])
  TH -- sim --> OPEN["Abre breaker por 30 min"]
  TH -- não --> HF["Held RuntimeFailed, sem retry automático"]
  OPEN --> HF
  HR --> LED
  HS --> LED
  HF --> UNK
```

## (g) Modelo de dados
Origem: `08` §4.3–4.4. `events` é append-only; `issues` é projeção reconstruível. Só o hash de tokens de webhook é guardado. S8: `verifyRound` em `ISSUES`. A trava da issue de (k.2) pode ser um índice único parcial em `RUNS(issueId)` para `status` ativo **[DECIDIR]**.

```mermaid
erDiagram
  ISSUES ||--o{ RUNS : "tem"
  ISSUES ||--o{ EVENTS : "gera"
  RUNS ||--o{ EVENTS : "gera"
  RUNS ||--o{ RUN_RESULTS : "aceita"
  ISSUES ||--o{ APPROVALS : "pede"
  RUNS ||--|| LEDGER : "custa"
  ISSUES {
    string id PK
    int githubNumber
    string state
    string specialist
    string heldReason
    int verifyRound
    int qaRound
    int reviewIter
    string headSha
  }
  RUNS {
    string id PK
    string issueId FK
    string role
    string model
    string sessionId
    float budgetUsd
    int maxTurns
    string status
    string resultSubtype
  }
  EVENTS {
    int seq PK
    string issueId FK
    string runId FK
    string type
    string payloadJson
    string actor
    string at
  }
  RUN_RESULTS {
    string runId FK
    string kind
    string acceptedAt
  }
  APPROVALS {
    string id PK
    string issueId FK
    string headSha
    string tier
    string expiresAt
    string decision
    string decidedBy
  }
  LEDGER {
    string runId FK
    float costUsd
    boolean costUnknown
    int inputTokens
    int outputTokens
    string day
  }
  BREAKER_STATE {
    string runtime PK
    string state
    string openedAt
    int failures
  }
  WEBHOOK_TOKENS {
    string hash PK
    string scope
    string usedAt
    string expiresAt
  }
```

## (h) Implantação local e VPS
Origem: `08` §4.11 e D3. M0–M2 no Windows do Alex; a partir de M3 numa VPS Linux com contêiner por run. O isolamento por contêiner via `spawnClaudeCodeProcess` é **[INFERIDO]** e será confirmado na FHP-034. Sem mudança na S8.

```mermaid
flowchart LR
  subgraph Local["M0-M2: PC Windows do Alex"]
    LN["Node 26 LTS: orquestrador, API, CLI"]
    LDB[("fhp.db SQLite")]
    LWT["worktrees em disco"]
    LCC["Claude Code empacotado no SDK, win32-x64"]
    LN --> LDB
    LN --> LCC
    LCC --> LWT
  end
  subgraph VPS["M3 em diante: VPS Linux"]
    SYS["systemd ou docker compose: contêiner fhp"]
    VDB[("fhp.db SQLite com backup diário")]
    RUNC["Contêiner por run com a worktree montada e rede restrita"]
    TLS["Proxy TLS para a API pública"]
    SYS --> VDB
    SYS --> RUNC
    TLS --> SYS
  end
  GH["GitHub"]
  ANT["API Anthropic"]
  SLK["Slack"]
  LN --> GH
  LCC --> ANT
  SYS --> GH
  RUNC --> ANT
  SLK --> TLS
```

## (i) Marcos
Origem: `08` §5. Dias de trabalho recalculados para TypeScript (curva de aprendizado incluída). Dependências entre colunas (o mermaid liga as setas à borda do grupo): M2 → M3 e M2 → M5; M4 → M7 e M6 → M7.

```mermaid
flowchart LR
  subgraph N["Núcleo, 35-63 d"]
    direction TB
    M0["M0 Fundação e spike SDK<br/>7-13 d"] --> M1["M1 MVP do loop<br/>24-42 d"] --> M2["M2 Limites e custo<br/>4-8 d"]
  end
  subgraph O["Operação"]
    direction TB
    M3["M3 Risco, Slack e VPS<br/>7-12 d"]
    M5["M5 Intake e Diagnose<br/>3-5 d"]
    M4["M4 Painel React<br/>8-13 d"]
    M6["M6 Pós-merge e revert<br/>5-8 d"]
  end
  subgraph E["Evolução"]
    direction TB
    M7["M7 Severidade, planner e evals<br/>3-5 d"] -.-> M8["M8 opcional<br/>Teammate, Linear, Brain"]
  end
  M2 --> M3
  M2 --> M5
  M3 --> M4
  M3 --> M6
  M5 --> M6
  M4 --> M7
  M6 --> M7
```

## (j) Laço pós-merge: incidente, Diagnose e revert por clique
Origem: `08` §5 M6 e D11; `09` FHP-045 a FHP-047. Estilo Lode `[VISTO 71:30]`: nada é revertido sem clique de pessoa; o PR de revert passa pelos mesmos gates. Estados em (b.2).

```mermaid
sequenceDiagram
  autonumber
  participant CI as GitHub Actions deploy
  participant O as Orquestrador
  participant MON as Monitor
  participant D as Agente diagnose
  participant H as Pessoa
  participant R as Agente reverter
  CI->>O: callback assinado com deployed_sha
  O->>O: DeployGate confere deployed_sha igual a merge_sha, se diferente abre incidente
  O->>O: estado Observing, janela de 30 min
  MON->>O: sinal de erro com dedup e limite por hora
  O->>O: abre incidente ligado ao deploy
  O->>D: query só leitura com dados externos delimitados
  D-->>O: diagnosis_set com causa, confiança, severidade e arquivo
  O->>O: issue em Held IncidentOpen
  O->>H: incidente com diagnóstico e botão Revert
  H->>O: clica Revert
  O->>R: query do reverter numa worktree nova
  R-->>O: PR de revert aberto
  O->>O: PR de revert segue verify, QA, Judge e gate humano, G2 a G7
```

## (k.1) Guardas de entrada: webhook de monitor
Origem: `08` §4.9 (G0) e §5 M5; `05` §2.2 (6 guardas do Felipe `[VISTO 43:20]`, mesma ordem, "da mais barata para a mais cara"); `09` FHP-017, FHP-042, FHP-043. Adaptações nossas: a guarda 1 vira HMAC + janela de tempo (FHP-017) e o Jev vira um classificador `haiku` com `enum noise|signal` (FHP-043), com falha aberta como no Felipe. Novo na S8.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 200}}}%%
flowchart TB
  W0["POST de monitor, M5"] --> A
  subgraph A["Guardas baratas, sem modelo"]
    direction LR
    W1(["1. HMAC válido e dentro da janela?"]) -- sim --> W2(["2. É sinal de erro?"]) -- sim --> W3(["3. Fábrica enabled?"])
    W1 -- não --> W1R["401, nada gravado"]
    W2 -- não --> W2R["200, ignora"]
    W3 -- não --> W3R["200, disabled"]
  end
  A -- "passou 1 a 3" --> B
  subgraph B["Guardas de volume e ruído"]
    direction LR
    W4(["4. Sinal repetido?"]) -- não --> W5(["5. Mais de 10 por hora?"]) -- não --> W6(["6. Classificador haiku diz ruído?"])
    W4 -- sim --> W4R["204, ignora"]
    W5 -- sim --> W5R["204, sem chamar modelo"]
    W6 -- ruído --> W6R["204, descarta"]
  end
  W6 -- "sinal, ou modelo fora do ar" --> W7["202, abre issue em Diagnose"]
```

## (k.2) Guardas de despacho e trava da issue
Origem: `05` §2.1 (interruptor, "trava da issue · uma só", 202 / 409 `[VISTO 42:15]`); `08` §4.4, §4.9 (G0); `09` FHP-016, FHP-029, FHP-045. A porta manual equivale à porta 2 do Felipe (`POST /executions`); não existe em `08` e fica **[DECIDIR]**. O callback de deploy usa `webhook_tokens` de uso único (`08` §4.4). Novo na S8.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 220}}}%%
flowchart LR
  T["Tick de 30 s: issue com label fhp pronta"] --> D1
  MAN["Porta manual POST /runs, DECIDIR"] --> D1
  D1(["Fábrica enabled?"]) -- não --> D1R["Não despacha; manual: 200 disabled"]
  D1 -- sim --> D2(["Trava da issue: já tem run ativa?"])
  D2 -- sim --> D2R["Não despacha; manual: 409"]
  D2 -- não --> D3["Grava a trava; manual: 202. Segue para breaker e orçamento em (f)"]
  CB["Callback de deploy, M6"] --> C1(["HMAC e janela ok?"])
  C1 -- não --> C1R["401"]
  C1 -- sim --> C2(["Token de webhook ainda não usado?"])
  C2 -- não --> C2R["409, nada acontece"]
  C2 -- sim --> C3["DeployRecorded; DeployGate em (b.2)"]
```

## (l) Agentes e permissões
Origem: `04` §1–3 (fichas e matriz do Lode), `08` §4.5, §4.6, §4.10, §10 e D8; `09` FHP-013, FHP-014, FHP-018 a FHP-023, FHP-044, FHP-047. Uma linha por papel: modelo e tetos (US$ / turnos / tempo), ferramentas built-in, ferramentas `mcp__fhp__*` e o efeito que só o orquestrador aplica. Diferenças em relação ao Lode, decididas em `08`: o QA não recebe `Edit`/`Write` (no Lode recebe, `04` §3); o Judge não tem `pr_merge` (no Lode tem; aqui o merge é da fábrica, `08` §4.1). **[DECIDIR]**: `issue_comment` para especialista e Judge (só o QA tem, `08` §4.5); `WebFetch`/`WebSearch` (o Lode concede ao frontend e ao qa `[VISTO 64:30, 66:05]`); modelo e tetos do reverter; planner (M7) fora do diagrama. Novo na S8.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 300}}}%%
flowchart LR
  TR["triage: haiku · US$ 0,50 / 3 turnos / 120 s · sem ferramentas"] --> TRt["outputFormat triage: especialista e motivo"] --> TRe["Comentário na issue; Held TriageFailed se inválida"]
  SP["especialista backend, frontend: sonnet · 3,00 / 60 / 2 h · Read, Glob, Grep, Edit, Write, Bash na allowlist"] --> SPt["criteria_set, work_report, git_push, pr_create"] --> SPe["Evento; push e PR feitos pelo orquestrador como fhp-author"]
  QA["qa: sonnet · 1,50 / 40 / 1 h · Read, Glob, Grep, Bash na allowlist · sem Edit e Write"] --> QAt["qa_report, issue_comment"] --> QAe["Evento; G3 confere worktree limpa e HEAD inalterado"]
  JU["judge: opus · 1,00 / 25 / 1 h · Read, Glob, Grep · sem escrita"] --> JUt["pr_diff, review_verdict"] --> JUe["Review postado como fhp-judge; merge só pela fábrica após G6 e G7"]
  DI["diagnose, M5: sonnet · 1,00 / 25 / 1 h · Read, Glob, Grep · só leitura"] --> DIt["diagnosis_set: evidência com path ou url"] --> DIe["Evento; high vai a InProgress, medium ou low a Held"]
  RV["reverter, M6: modelo e tetos DECIDIR · ficha de especialista, worktree nova"] --> RVt["git_push, pr_create, work_report"] --> RVe["PR de revert como fhp-author; segue G2 a G7"]
  NEG["Negado a todos, PreToolUse G-tool: git push, gh e curl no Bash; escrita fora da worktree ou em .fhp e .claude; MCP fora do fhp, strictMcpConfig; env sem tokens do GitHub"]
```

## (m) Painel: telas e ações
Origem: `08` D13 (React 19 + Vite) e §5 M4; `09` FHP-037 a FHP-041; Lode: Board "issues e Needs you", Flow "agentes ao vivo", Workflow "etapas e aprovadores", Quality "custo por PR" `[VISTO 71:30]`, run com Turn n/max, Budget, timeline ao vivo e Pause Agent `[VISTO 70:10]`. Toda ação passa pela API e vira evento (`08` §5 M4); o painel lê por GET e SSE. A projeção `issues` e `events` estão no mesmo banco SQLite; o nó aparece duas vezes só para manter o fluxo da esquerda para a direita. **[DECIDIR]**: rotas de ação em Held e de pausa; telas Library e Telemetry do Lode (sem issue no `09`); autenticação do painel quando a API ficar exposta na VPS. Novo na S8.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 170}}}%%
flowchart LR
  EVR[("SQLite: events e projeção issues")] --> GET["GET via TanStack Query: issues, runs, custos, config"]
  EVR --> SSE["SSE de events, aparece em menos de 2 s"]
  GET --> BO["Board: issues por estado, FHP-038"]
  GET --> QU["Quality: custo por PR mesclado, Judge na 1a rodada, rodadas de QA, FHP-040"]
  GET --> WF["Workflow: estágios, agentes e problemas do config check, FHP-041"]
  GET --> NY["Needs you: Held com heldReason e pedidos de aprovação, FHP-038"]
  SSE --> RU["Issue e run ao vivo: timeline, turno, custo e teto, FHP-039"]
  NY -- "aprovar ou negar, com confirmação" --> AP["POST /approvals"]
  NY -- "retomar, rejeitar ou Revert" --> HA["Ação em Held, rota DECIDIR"]
  RU -- "Pausar" --> AB["Abortar run, rota DECIDIR"]
  AP -- "ApprovalDecided human:web" --> EVW[("events append-only")]
  HA -- "InProgress, Canceled ou Reverting" --> EVW
  AB -- "Held PausedByHuman" --> EVW
```

## Siglas
- **API:** interface de programação. **CI:** integração contínua. **CLI:** linha de comando. **ER:** entidade-relacionamento. **HMAC:** assinatura com chave secreta. **HTTP:** protocolo web; **200/202/204/401/403/404/409/422:** ok / aceito / sem conteúdo / não autorizado / proibido / não encontrado / conflito / conteúdo inválido. **JSON:** formato de dados. **MCP:** Model Context Protocol. **PR:** pull request. **QA:** garantia de qualidade. **SDK:** kit de desenvolvimento. **SHA / head_sha / headSha:** identificador do commit / último commit do PR. **SPA:** aplicação de página única. **SSE:** Server-Sent Events. **TLS:** criptografia de transporte. **VPS:** servidor virtual privado. **WAL:** modo de journal do SQLite com leitura concorrente.
- **G0…G7, G-tool:** gates (`08` §4.9). **M0…M8:** marcos (`08` §5). **D3, D6, D8, D11, D13:** decisões (`08` §0). **FHP-nnn:** issues (`09`).
