# Regras, gates e limites (S4)

Marcas: **[VISTO]** frame, **[FALA]** só análise/áudio, **[INFERIDO]**, **[a confirmar]**, **[DECIDIR]** decisão nossa. `[mm:ss]` = instante do vídeo. Frames em `00-fontes/frames/` (lista em `sessoes/saida/S4-frames.md`). Origens: `[Lode]` (demo de William Fernandes, cap. 7), `[Felipe/Step Functions]` (cap. 5), `[conceito/Waldemar]` (caps. 3, 4, 8). Valores copiados literalmente dos frames; onde a análise do Gemini diverge, vale o frame (ver seção 9).

## 1. Visão: onde ficam as regras
- **[conceito/Waldemar] Plano de qualidade** [28:45, VISTO, `frame_2845_camadas-qualidade.jpg`]: três blocos: **Gates** ("CI verde, verificador, review humano, merge"), **Observabilidade** ("OpenTelemetry, custo por run e por estágio") e **Evals** ("rubricas, golden set, veredito humano"). Há um laço vermelho "novos sinais" do plano de qualidade de volta ao plano de trabalho.
- **[conceito/Waldemar] Plano de controle** [28:45, VISTO]: bloco "Contrato: stages.yaml, critérios de entrada e saída", "Dispatcher: implícito no agente ou workflow engine", "Identidade: Linear app, GitHub App, Slack bot, cofre de secrets".
- **[conceito/Waldemar] Quinto pilar "Validação e Gates"** [FALA 27:43, análise]: trava de CI, regras por coluna no Linear (não passa para review sem critérios), verificador interno na implementação (spec-lean) e o Judge no PR. O Gemini fala em "quatro pilares" e lista cinco itens; o slide mostra quatro planos + Brain transversal [VISTO].
- **[conceito/Waldemar] Princípio do Felipe** [37:46, FALA]: "o controle da fábrica fica na fábrica, não na mão dos agentes". O slide 39:44 [VISTO] diz: o agente "não segura chave, não publica, não decide"; o contrato "Fora dele, a fábrica recusa".
- **[conceito/Waldemar] Humano obrigatório** [13:42, VISTO no diagrama; FALA]: discovery/design e validação final; "tarefa pequena vai direto"; "Implementação usa um contrato de verificação para validar que tudo foi feito". Dado de contexto: monday.com com "mais de 56%" dos PRs aprovados sem humano [17:18, FALA]; Waldemar estima 30% a 40% do backlog [FALA].

## 2. [Felipe/Step Functions] Pipeline determinístico e seus gates
Oito etapas [39:44, VISTO]: Evento, Entrada (guardas e Jev), Roteamento (Cursor ou Kiro), Contrato (tarefa e token), Agente, Validação (6 portões, 7 regras), Publicação (review, merge, deploy), Entrega (medir ou reverter).

### 2.1 Evento [42:15, VISTO]
Mensagem SNS (`"Type": "Notification"`, `MessageId` "id único", `Subject` "ALARM: api-5xx-high", `Message` = "JSON dentro do JSON": `AlarmName` "api-5xx-high", `NewStateValue` "ALARM", `NewStateReason` "5xx > 20 em 5 min"). Porta 1 automática: alarme → SNS → intake. Porta 2 manual: `curl -X POST "$API/executions"` com `Authorization: Bearer ••••` e `{"issue_number": 142}`. Cadeia: **Interruptor** `enabled = true` → **Trava da issue** `issue#142 · uma só` → **StartExecution** `issue-142-1`. Respostas: **202 criada** / **409 a issue já tem execução** (trava por issue = idempotência de entrada).

### 2.2 As 6 guardas de entrada [43:20, VISTO]
"Seis guardas em ordem. O Jev só entra no fim, para separar ruído de sinal."
| # | Guarda (literal) | Resposta (literal) | O que faz |
|---|---|---|---|
| 1 | Não é ALARM? | 200 · ignora | descarta o que não é alarme |
| 2 | Fábrica desligada? | 200 · disabled | interruptor global |
| 3 | Mensagem repetida? | 204 · ignora | deduplicação (por `MessageId` [INFERIDO]) |
| 4 | Mais de 10 por hora? | 204 · sem chamar o Jev | limite de taxa; corta antes de gastar modelo |
| 5 | Jev diz ruído? | 204 · descarta | triagem por modelo |
| 6 | Sinal, ou Jev fora do ar | 202 · abre a issue | falha aberta: se o Jev cai, investiga |
- Chamada ao Jev: `POST /ai/run · Jev 1.14`, `"model": "typesafe/jev-1.14.0"` ("modelo fixado"), `questions: {"noise": {"type": "choice", "criteria": {"noise": "drop; no issue", "signal": "real incident"}}}` ("escolha tipada"); resposta 200 `{"answers": {"noise": {"choice": "signal"}}}`.
- Nota do slide: "Jev fora do ar: a fábrica investiga e abre a issue. Versão fora da allowlist: **a chamada nem sai**."
- Ordem "da mais barata para a mais cara" [FALA 39:44]: coerente com a tabela [INFERIDO]. Grafia é **Jev**, não GEV. O que é o Jev (modelo de triagem de múltipla escolha) segue **[a confirmar]**.

### 2.3 Roteamento e disjuntor [45:00, VISTO]
- Estado `Diagnose`: `"Type": "Task"`, `"Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken"`, `"TimeoutSeconds": 3600`, `"Next": "OpenPR"`, etiqueta "**sem Retry, sem Catch**". Timeouts por etapa: Diagnose **3600 s**, OpenPR **7200 s**, Review **3600 s**.
- Violação: "Estourou o timeout: a execução falha. Sem retry cego em etapa de agente."
- `pick(mode, quotas)`: `off` → None; `kiro` → KIRO; `cursor` → CURSOR; senão `choose_auto(quotas)`. `remaining(entry) = (ceiling - used) / ceiling`.
- **Modo auto:** "Mais cota livre pega a tarefa. Empate vai para o Kiro."
- **Disjuntor:** "Executor doente sai da fila. Timeout, 5xx ou 429. Sem cota nenhuma: **BudgetExhausted**."

### 2.4 Contrato de tarefa e token [46:45, VISTO]
Tarefa enviada ao agente (JSON): `"source": "factory"`, `"stage": "diagnosis"` ("uma etapa"), `"issue_number": 142`, `"execution_arn"`, `"result_fields": ["root_cause","evidence","proposed_change","risk","affected_components","load_relevant"]` ("o que deve voltar"), `"callback_url": "https://api.example/callback"`, `"callback_bearer": "••••"` ("uso único"), `"task_id": "issue-142"`.
Mapa etapa → agente, cada um com "token próprio": `diagnosis` → agente **Triage**; `pr_opened` → agente **Ship**; `review_verdict` → agente **Review**. Executor: Cursor Cloud Agent (POST com o token da etapa); alternativa Kiro: `kiro-cli chat --v3 --no-interactive --cloud --repo org/repo "<tarefa>"`.
O agente só recebe etapa, campos esperados e para onde responder [39:44 VISTO; FALA 39:44].

### 2.5 Os 6 portões do callback [48:15, VISTO]
Requisição `POST /callback` com `Authorization: Bearer ••••`; corpo `{task_id, execution_arn, stage, status:"ok", result:{...}}`. Regra "cada chave, uma etapa": `triage→diagnosis · ship→pr_opened · review→review_verdict`.
| # | Portão (literal) | Código (literal) |
|---|---|---|
| 1 | Bearer válido? | 401 Unauthorized |
| 2 | Etapa permitida para esta chave? | 403 Forbidden |
| 3 | Tarefa existe? | 404 Not Found |
| 4 | Token ainda não usado? | 409 Conflict |
| 5 | Resultado dentro do schema? | SchemaInvalid |
| 6 | send_task_success | 200 · a máquina avança |
- Anti-replay: "**replay do mesmo token: 409, nada acontece**".
- "deploy_result, rollback e provas: **só a fábrica escreve**" (o agente não grava esses campos).
- Observação: o slide tem 5 verificações + o sucesso; "6 portões" conta o `send_task_success`. A análise lista só 4 portões (omite o de etapa/403).

### 2.6 Validação: as 7 regras [49:28, VISTO]
Tabela "VALIDAÇÃO · 7 REGRAS" (recusado / aceito):
| # | Regra (literal) | No JSON recusado |
|---|---|---|
| 1 | Só campos do contrato | falha (`"merge": true` "fora do contrato") |
| 2 | Todos os campos obrigatórios | falha (faltam `proposed_change`, `affected_components`, `load_relevant`) [INFERIDO] |
| 3 | issue_number inteiro, 1 ou mais | passa (142) |
| 4 | root_cause com 20+ caracteres | falha (`"Bug"`, "< 20 caracteres") |
| 5 | evidence com ao menos 1 item | falha (`[]`, "vazio") |
| 6 | risk em low, medium ou high | falha (`"critical"`, "fora do enum") |
| 7 | load_relevant booleano | "−" (ausente) |
- JSON **aceito**: `issue_number` 142; `root_cause` "Pool de conexões esgotado" (25 caracteres); `evidence` ["timeout em 5xx após deploy"]; `proposed_change` "Aumentar o limite do pool"; `risk` "medium"; `affected_components` ["api"]; `load_relevant` false; **`jev_score` 0.91** com a etiqueta "**Jev opina, não decide**" (o score acompanha o resultado, não é regra de aceite) [VISTO].
- Violação: "**SCHEMAINVALID.** Etapa de agente não tem Retry nem Catch. **A execução termina.**"

### 2.7 Publicação: veredito do Judge amarrado ao commit [52:00, VISTO]
"O Judge devolve um veredito, não um texto. A máquina só lê dois campos: **verdict** e **head_sha**."
- JSON `changes_requested`: `head_sha` "9f2c4e1a7b3d5c0e8a6f4b2d9c1e3a5b7d0f2c4e", `findings` ["Falta teste para o limite do pool", "Timeout fixo, sem configuração"] (etiqueta "volta ao agente"). JSON `approve`: `head_sha` "c71e0a94d2b6f8531e7a9c4d0b2f6e8a1c3d5b7f", `findings` [] ("libera o gate").
- `ReviewGate · Choice` (literal): se `verdict == "approve"` e `head_sha == pr.head_sha` → `PostReviewStatus`; senão se `verdict == "changes_requested"` e `iter < 3` → `iter += 1; feedback = findings` → `OpenPR`; senão (`# reject ou estouro`) → `Fail`.
- Notas: "Veredito de outro commit não vale: o head_sha tem que ser o do PR. Reprovação volta ao agente com o feedback, **até 3 vezes**."

### 2.8 Entrega: merge, deploy, medição e rollback [53:30 e 55:15, VISTO]
Passos (literal): **AwaitingMerge** ("um humano aprova; **auto-merge desligado**"), **AcquireDeploy** ("lock de deploy: um por vez"), **Merge** ("squash, com o sha exato do PR"), **WritePending** ("grava o sha do merge no SSM"), **Deploy** ("workflow na main, callback assinado"), **DeployGate** ("sha implantado igual ao do merge"), **WaitMeasure** ("30 minutos antes de medir").
- `deploy_result`: `status "success"`, `sha`, `deployed_sha`. `DeployGate · Choice`: se `deploy.status == "success"` e `deploy.deployed_sha == merge_sha` → `WaitMeasure`; senão → `Rollback`.
- Limiares `/factory/thresholds` ("um parâmetro, sem deploy"): `tick_max_s: 300`, `released_min: 1`, `iam_errors: 0`, `ddb_errors: 0`, `pool_errors: 0`. `passed: true` → "Grava o **last-good-sha**"; `passed: false` → "Vai para Rollback". Meia hora depois "a fábrica recalcula as métricas".
- **Rollback** (7 passos, "Primeiro a produção recua. Depois o git é corrigido por um revert provado"): 1 Rollback (redeploy do last-good-sha), 2 RollbackGate (`deployed_sha` igual ao last-good do SSM), 3 OpenRevert (PR que reverte o merge ruim), 4 RevertProof (prova no staging, como qualquer PR), 5 EvaluateRevert (mesmos limiares da prova normal), 6 RevertMerge (a App faz o merge do revert), 7 RolledBack ("a execução termina em falha, de propósito"). Exemplo: `measure` `passed:false`, violações `tick_max_s 437 > 300`, `released 0 < 1`, `pool_errors 3 > 0`.
- "O último hash estável no AWS SSM Parameter Store" [FALA 39:44] confirmado como `last-good-sha` / SSM [VISTO].

### 2.9 Não ao retry cego [44:46 FALA; 45:00 VISTO]
Etapa de agente sem Retry/Catch; timeout, SchemaInvalid e reprovação além de 3 rodadas terminam a execução. Fala: "retry cego em agente é queimar dinheiro". Único laço permitido: reprovação do Judge, limitado por `iter < 3`.

### 2.10 Prosa pede, contrato garante [57:30, VISTO]
Slide final: "Prosa pede. Contrato garante. AGENTES EXECUTAM · A FÁBRICA GOVERNA". [FALA 55:56] instrução em linguagem natural é um pedido; contratos e harness mantêm a linha. Capítulo 6 (56:36-63:30) é discussão em webcam [VISTO 62:30, 63:40]; conteúdo só na análise, sem valores novos **[FALA, sem frame]**.

## 3. [Lode] Regras e limites (demo de William Fernandes)
Config em `/Users/williamfernandes/Reborn/find-photos/lode.yaml · config version 2` [65:28 VISTO]. Salvar chaves marcadas **confirm** exige digitar o nome do workspace ("saving needs the workspace's name typed · other keys save as today · no key is locked").

### 3.1 Flow & QA [65:21–65:26, VISTO] (`frame_6521_lode-flow-qa.jpg`, `frame_6524_lode-flow-qa-b.jpg`)
Cabeçalho: "local tracker only · specialists implement, QA validates".
| Parâmetro (literal) | O que faz | Valor visto | Onde |
|---|---|---|---|
| `flow` (confirm) | liga o fluxo; desligado, `issue_update` de cada agente age sem o fluxo | **on** | Settings > Flow & QA |
| `flow.implement` | estado onde os especialistas trabalham | **In Progress** (default In Progress) | idem |
| `flow.validate` | estado onde o QA valida | **QA** (default QA) | idem |
| `flow.review` | para onde vai a issue com QA Report "pass" | **In Review** (default In Review) | idem |
| `flow.human_review` | onde uma pessoa assume; "neither active nor terminal" | **Human Review** (default Human Review) | idem |
| `flow.diagnose` | opcional; onde um agente só-leitura diagnostica | **Diagnose** (default: nenhum) | idem |
| `flow.max_qa_rounds` | "1 to 10; how many fail QA Reports go back to the specialist" | **3** (default 3) | idem |
| `flow.screen_paths` | ramo que muda caminho casado precisa de screenshot por critério em "pass" | `**/*.html`, `**/*.erb`, `**/*.jsx`, `**/*.tsx`, `**/*.vue`, `**/*.svelte`, `**/*.css`, `**/*.scss`, `**/app/views/**`, `**/components/**`, `**/pages/**` ("these are the defaults") | idem |
| `flow.pr_evidence` | "a pass QA Report puts its evidence on the pull request" (**Evidence on PR**) | **true** (default true) | idem |
| `flow.triage.model` | modelo Claude da chamada de triagem (escolhe especialista para issue sem label) | **haiku** (default haiku) | idem |
| `flow.triage.max_budget_usd` | "the most one triage call may spend" | **0.50** (default 0.50) | idem |
- **Roster check** (".lode/agents/*.yaml against the form, before saving", "0 problems"): implement/In Progress → backend, database, frontend, infra, reverter, security; validate/QA → qa; review/In Review → judge; human_review/Human Review → "a person"; Todo (sem estágio) → backend, database, frontend, infra, planner, security; Diagnose → diagnose. Estados sem estágio mostram "holds no stage with this form". Violar: salvar com agente sem estágio acusa problema no check [INFERIDO].
- Violação de Evidence on PR: "A workspace without a GitHub origin or a GitHub token must set it to false, or every QA pass is refused with **github_origin_missing** or **github_unauthorized**" [VISTO]. Estado visto: "repository find-photos ... github.token $GITHUB_TOKEN is set (workspace)".
- Legenda queimada [FALA/VISTO 65:21]: "Cada estágio é checado contra os agentes, ... de rodadas." e "QA: o QA fecha o relatório, critério por critério" e "O QA não pode editar código: sobe o app e testa no navegador" [VISTO, captions no vídeo].
- As regras de canvas **Max rounds** e **Evidence on PR** (paleta "Rules", 64:43 [VISTO]) correspondem a `flow.max_qa_rounds` e `flow.pr_evidence` [INFERIDO]; o canvas não mostrou os valores por nó **[a confirmar]**.

### 3.2 Risk e PR policy [65:28, VISTO] (`frame_6528_lode-risk.jpg`)
Texto: "classifies a pull request before Lode merges it under `pull_requests.merge: auto`; **high is held for a person**". Abas: `top level`, `repository find-photos`. Lógica: "Any rule that matches a changed path makes the verdict **high** and no model is asked. With no match the model reads the diff against the policy text: low or high. No rule gives low."
| Regra | Casa (literal, truncado no frame) | On a match | Toggle |
|---|---|---|---|
| migrations | `**/migrations/**`, `**/migrate/**`, `**/alembic/**`, `**/schema.rb` +3 | high | on |
| infra | `**/*.tf`, `**/*.tfvars`, `**/Dockerfile*`, `**/docker-compose*.yml` +7 | high | on |
| ci | `.github/**`, `.gitlab-ci.yml`, `.circleci/**`, `**/Jenkinsfile` | high | on |
| dependencies | `**/package.json`, `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml` +13 | high | on |
| secrets | `**/.env*`, `**/*.pem`, `**/*.key`, `**/*credentials*` +1 | high | on |
| agent_config | `lode.yaml`, `agents/**`, `.lode/**`, `**/AGENTS.md` +3 | high | on |
| size | "more than max_changed_lines or max_changed_files, or a file without a patch" | high | on |
| project | "none + glob" (globs próprios; `risk.rules` confirm) | high | (editável) |
- "Off writes the rule's name to `risk.ignore`. Globs are case-sensitive; `**` is any number of directories. **A diff over 100 KB is always high (rule size), even with size off.**"
- `risk.max_changed_lines` (confirm) = **2000** ("more changed lines trips size (default 2000)"). Logo abaixo há `risk.max_...` com valor **50** (provavelmente `risk.max_changed_files`) **[a confirmar]**, cortado no frame.
- Merge: `pull_requests.merge: auto` é o valor citado no texto da tela; o botão "PR policy" do canvas abre a política **[a obter]** (página não mostrada).
- Resultado da classificação aparece no pedido de aprovação como `"tier": {"reason": "the repository has no CI configuration", "tier": 2}` [VISTO 68:45, texto completo; S6, `frame_6845_s6-verif-slack.jpg`]. O mesmo `tier 2` aparece em GLO-40 e GLO-41. Como `tier 2` se relaciona com `low`/`high` **[a confirmar]**.

### 3.3 Portão de merge e aprovação [68:30 e 69:10, VISTO] (`frame_6830_slack-aprovacao-merge.jpg`, `frame_6910_slack-lode-pedido-aprovacao.jpg`)
- Issue GLO-41 "Add a GET /version endpoint to the backend" (In Review, P0): o Judge chama `mcp__lode__pr_ready` (PR #23 de `globsecure/sandbox-lode-test`, `"draft": false`), depois `tool_call mcp__lode__pr_merge({})` e o log mostra `[approval_requested] merge · pr_merge · e5f0b0c9` com o comando `lode approvals approve e5f0b0c9`. Aviso na tela: "Pending next step: **gate merge waits for your approval**" com botões **Deny** / **Approve**. Contadores: "Needs Review · 1 gate", "Active Runs 1 running".
- Mensagem no Slack (canal `lode`, app Lode, 17:01): "**Approval needed** · Workspace `lode-test` · Gate `merge` · Tool `pr_merge` · Issue `GLO-41` · Agent `judge` · **Expires `2026-11-03T17:31:53.142Z`** [~30 min após o pedido, INFERIDO] · Pull request ...pull/23 · Arguments `{"head": "488272fab8636ea1e97e04d66fcca0394233ac53", "tier": {"reason": "the repository has no CI configuration", "tier": 2}, "url": ...}` [VISTO 68:45, S6] · "To decide, run `lode approvals approve e5f0b0c9` or `lode approvals deny e5f0b0c9`" + botões Approve/Deny.
- Registro anterior (GLO-40): "**Approval decided** ... approved by William, 2026-11-03T16:30:15Z".
- Ponto-chave: a aprovação carrega o **`head` (SHA do commit)** do PR: mesma ideia do `head_sha` do Felipe (aprovação amarrada ao commit) [INFERIDO a partir do campo; regra de bloqueio se o head mudar **[a confirmar]**].
- A fala "se o PR for de risco high, vai para uma pessoa" aparece nas legendas queimadas: "Regras de risco: migração, infra e CI classificam o PR como high e vão para uma pessoa." [65:28 VISTO]; "O merge também pode ser aprovado aqui no painel do Lode, com confirmação" [VISTO caption].

### 3.4 Orçamento por issue e turnos máximos [67:00 e 68:30, VISTO]
| Issue | Budget | Turnos | Observação |
|---|---|---|---|
| FP-59 (`frame_6700_s3-full.jpg`) | "Budget $200.00" (Agent configuration: "Budget Limit **$200.00 max**", "Max turns **10**"); "Issue total $0.47 · cost partly unknown"; "Turn 1 / 10" | 10 | modelo `claude`/`sonnet` (`claude-sonnet-5-5`); Run 1 frontend 558.1k tok ≈ $0.30 |
| GLO-41 (`frame_6830_slack-aprovacao-merge.jpg`) | "Budget **$1.00**"; "Issue total $0.12" | "Turn 1 / **5**" | Judge com `claude-opus-5-5` |
- O teto e os turnos variam por issue/agente; onde se definem (campo do agente em `.lode/agents/*.yaml` ou `lode.yaml`) **[a confirmar]**. Comportamento ao estourar: **não mostrado** **[a confirmar]**.
- Triagem tem teto próprio: `flow.triage.max_budget_usd` 0.50 (3.1).
- Controles manuais: **Pause Agent**, **Terminal Console**, **Create Patch / PR**.

### 3.5 Limits, Usage & breaker, Notifications [não mostrados]
Os itens "Limits", "Usage & breaker (every workspace)", "Notifications" existem no menu Settings [64:43 VISTO], mas **nenhuma tela dessas páginas aparece** nos trechos 64:15-72:00 (conferido por contact sheets: só Board, Intake, Workflow, Flow & QA, Risk, Agents, issue, Flow ao vivo, Linear, Sentry, Slack). Não inventar parâmetros: ver lacunas. A inferência por nome (teto de uso e "breaker" que corta ao exceder) fica **[INFERIDO, a confirmar]**.

### 3.6 Judge como gate no Lode [67:00, VISTO]
Prompt: "You are the judge of this workspace. You review the pull request of an issue that passed QA and merge it when it is right." Ferramentas concedidas: Read, Glob, Grep, pr_review, pr_ready, pr_merge, issue_update. Skill `lode:the-judge`. Slide 72:10 [VISTO]: "QA valida critérios → Judge outro modelo → Merge por risco → Prod + observação"; "3. Prova + QA + Judge: verify e lint antes; **quem faz não avalia**"; "4. Custo por etapa e por PR mesclado (OTLP para o Langfuse)"; "Na régua da linha: dispatcher 3 → 5 · verificação 2 → 4 · medição 2 → 4"; "O que não muda: o humano nas pontas e nos gates".

## 4. Contrato de verificação (critérios de aceite): como é escrito e checado
1. **Escrita:** os critérios vão na descrição da issue, em "Criterios de aceite" numerados e testáveis [67:00 VISTO]. Exemplo FP-59: (1) `/sell` mostra a seção "Perguntas frequentes" antes do CTA final com 4 perguntas e respostas; (2) todo o texto vem do i18n em pt-BR e en (`i18n-tasks` limpo); (3) layout legível em 390px e no desktop, sem overflow horizontal; (4) um teste cobre a seção com as 4 perguntas; testes da landing, `rubocop` e `vslice_lint` passam. Padrão: critério observável + comando/ferramenta que prova.
2. **Quem escreve:** na demo, o "frontend escreve os critérios, implementa, faz o commit e abre o PR" (caption 65:50 VISTO). Triagem escolhe o especialista e "deixa o motivo escrito na issue" (caption VISTO); sem label de especialista, o `flow.triage.model` (haiku) decide.
3. **Checagem pelo QA:** agente `qa` (só no estágio QA) sobe o app e testa no navegador; **não edita código**; fecha o relatório "critério por critério"; para caminhos em `flow.screen_paths` exige **screenshot por critério** em "pass". Reprovado volta ao especialista até `flow.max_qa_rounds` (3). Em "pass", a evidência vai ao PR (`flow.pr_evidence: true`).
4. **Checagem pelo Judge:** agente `judge` (outro modelo; vê Read/Glob/Grep) lê o diff, faz `pr_review` e `pr_ready`, e tenta `pr_merge`; o merge passa pelo classificador de risco (3.2) e, se `high`, pelo gate humano (3.3).
5. **Equivalente Felipe:** o contrato é o schema do callback (`result_fields`) + 7 regras (2.6); o Judge devolve `verdict` + `head_sha` (2.7).
6. **Conceito:** "Implementação usa um contrato de verificação" [13:42 VISTO]; no plano de controle, "Contrato: stages.yaml, critérios de entrada e saída" [28:45 VISTO]. O formato do `stages.yaml` não foi mostrado **[a confirmar]**.

## 5. Custos e roteamento de modelos (cap. 8) [FALA, sem frame]
- **[FALA 78:52]** Custo mensal: licença normal do Linear, licença de GitHub para o bot, conta Anthropic "em torno de US$ 100/mês", VPS "em torno de US$ 40/mês" (~US$ 140/mês). Sem frame (a tela é webcam/Slack); **[a confirmar no áudio]**.
- **[FALA 80:33]** Roteamento por severidade: impacto *Low* (fatia simples, desfaz com revert) em modelo menor/médio (Sonnet); *High* (migração de banco, breaking change) em Opus; o agente de triagem classifica. Versão do modelo não confirmada.
- **Confirmações indiretas [VISTO]:** `flow.triage.model = haiku` (triagem barata); issue FP-59 rodando em `claude-sonnet-5-5`; Judge de GLO-41 em `claude-opus-5-5`; classificação de risco `low/high` do Lode decide gate humano (3.2). Não há no Lode uma regra "modelo por severidade" mostrada **[a confirmar]**.
- Qualidade do código [76:26, FALA]: base limpa e padronizada é pré-requisito, senão "o agente alucina".

## 6. Tabela consolidada de parâmetros
| Origem | Nome | Função | Valor | Onde configura | Ao violar | Fonte |
|---|---|---|---|---|---|---|
| Felipe | rate limit intake | limite de alarmes por hora | 10 por hora | guarda 4 (Lambda/intake) [INFERIDO] | 204 sem chamar o Jev | 43:20 VISTO |
| Felipe | interruptor | liga/desliga fábrica | `enabled = true` | config da fábrica [INFERIDO] | 200 · disabled | 42:15, 43:20 VISTO |
| Felipe | trava da issue | uma execução por issue | `issue#142 · uma só` | StartExecution (nome `issue-142-1`) | 409 a issue já tem execução | 42:15 VISTO |
| Felipe | modelo Jev | triagem ruído/sinal | `typesafe/jev-1.14.0`, allowlist | chamada `/ai/run` | fora da allowlist: chamada não sai; Jev fora do ar: abre issue | 43:20 VISTO |
| Felipe | TimeoutSeconds | prazo por etapa | 3600 (Diagnose), 7200 (OpenPR), 3600 (Review) | ASL do Step Functions | execução falha, sem retry | 45:00 VISTO |
| Felipe | modo do roteador | escolha do executor | off / kiro / cursor / auto; empate → Kiro | `pick(mode, quotas)` | sem cota: BudgetExhausted | 45:00 VISTO |
| Felipe | disjuntor | tira executor doente | timeout, 5xx, 429 | roteador | executor sai da fila | 45:00 VISTO |
| Felipe | token de callback | autoriza resposta | uso único, "token próprio" por etapa | contrato da tarefa | 401/403/404/409 | 46:45, 48:15 VISTO |
| Felipe | schema do resultado | 7 regras | ver 2.6 | validação na fábrica | SCHEMAINVALID, execução termina | 49:28 VISTO |
| Felipe | veredito do Judge | gate de review | `verdict` + `head_sha == pr.head_sha`; `iter < 3` | ReviewGate (ASL) | outro commit: não libera; 3 reprovações: Fail | 52:00 VISTO |
| Felipe | auto-merge | quem funde | desligado; humano aprova | AwaitingMerge | espera humano | 53:30 VISTO |
| Felipe | lock de deploy | um deploy por vez | um por vez | AcquireDeploy | espera lock [INFERIDO] | 53:30 VISTO |
| Felipe | DeployGate | sha igual ao merge | `deployed_sha == merge_sha` | ASL | Rollback | 53:30 VISTO |
| Felipe | limiares | saúde pós-deploy | tick_max_s 300; released_min 1; iam/ddb/pool_errors 0; espera 30 min | `/factory/thresholds` | Rollback automático | 53:30, 55:15 VISTO |
| Felipe | last-good-sha | alvo do rollback | último hash estável | SSM Parameter Store | RollbackGate confere | 55:15 VISTO |
| Lode | flow.max_qa_rounds | rodadas QA→especialista | 3 (1 a 10) | Settings > Flow & QA | [a confirmar] o que ocorre após 3 | 65:26 VISTO |
| Lode | flow.pr_evidence | evidência no PR | true | idem | github_origin_missing / github_unauthorized | 65:24 VISTO |
| Lode | flow.screen_paths | exige screenshot | 11 globs | idem | pass sem screenshot não vale [INFERIDO] | 65:24 VISTO |
| Lode | flow.triage.model / max_budget_usd | triagem | haiku / 0.50 | idem | [a confirmar] | 65:24 VISTO |
| Lode | risk.rules | 7 regras + project | todas on, high | Settings > Risk | PR `high` retido para pessoa | 65:28 VISTO |
| Lode | risk.max_changed_lines | gatilho `size` | 2000; diff > 100 KB sempre high | idem | high | 65:28 VISTO |
| Lode | pull_requests.merge | política de merge | `auto` (com `high` retido) | lode.yaml / botão PR policy | gate humano | 65:28 VISTO (texto) |
| Lode | gate merge | aprovação humana | Approve/Deny; expira (~30 min) | Slack ou painel ou `lode approvals approve <id>` | expira [a confirmar o efeito] | 68:30, 69:10 VISTO |
| Lode | Budget Limit | teto por issue | $200 max (FP-59); $1.00 (GLO-41) | Agent configuration | [a confirmar] | 67:00, 68:30 VISTO |
| Lode | Max turns | turnos por run | 10 (FP-59); 5 (GLO-41) | idem | [a confirmar] | 67:00, 68:30 VISTO |
| Lode | Limits / Usage & breaker / Notifications | limites globais | não mostrado | Settings | n/d | 64:43 (só menu) |

## 7. Origem [conceito/Waldemar]: resumo das regras de política
- Humano nas pontas (intenção, discovery/design) e nos gates críticos; resto automático [13:42 VISTO].
- Tarefa pequena pula Research/Plan (atalho Backlog → ToDo) [13:42 VISTO].
- Judge consciente de risco: chama humano se a mudança toca regra de negócio com muitos commits [16:04, FALA].
- Slack/Linear como entrada única; "todo sinal entra pela triagem" [13:42 VISTO].
- Primeiro passo recomendado [77:08, FALA]: skills do time, teammate, Brain, integrações.

## 8. Decisões nossas [DECIDIR]
1. **Merge automático vs humano:** adotar modelo de risco `high`/`low` (como Lode 3.2) e começar com **auto-merge desligado** (como Felipe 2.8) só ligando para `low`? Definir lista de caminhos `high` do nosso repo.
2. **Aprovação amarrada ao commit:** exigir `head_sha` igual no merge (Felipe 2.7) e invalidar aprovação se o PR mudar.
3. **Rodadas máximas:** QA = 3 (Lode) e Judge = 3 (Felipe); manter 3 ou ajustar.
4. **Tetos de custo:** por issue (referência: $1 a $200 no Lode), por triagem (0.50), por mês (referência ~US$ 140 de infra+API) e comportamento ao estourar (parar, pausar e avisar, escalar para humano).
5. **Turnos máximos** por agente (referência 5 e 10) e timeout por etapa (referência 3600/7200 s).
6. **Retry:** adotar "sem retry cego" e só reprovação do Judge como laço.
7. **Disjuntor:** quais códigos tiram um executor da fila (referência: timeout, 5xx, 429) e quem reativa.
8. **Roteamento de modelo:** triagem em modelo barato, implementação em Sonnet, risco alto/Judge em Opus; critério de severidade; se o modelo do Judge deve ser diferente do implementador ("quem faz não avalia").
9. **Rate limit de intake** (referência 10/h), dedup, interruptor global.
10. **Tokens de callback:** uso único, por etapa, com 409 em replay; onde guardar (cofre; nunca em arquivo).
11. **Rollback:** última versão boa gravada fora do repositório e limiares versionados separadamente do deploy.
12. **Formato do contrato de verificação** (critérios na issue, QA com screenshot, schema JSON com 7 regras) para o nosso fluxo.

## 9. Correções à análise do Gemini (frame vale)
- Guardas: frame mostra **6** (alarme, fábrica ligada, repetida, 10/h, Jev, falha aberta); Gemini listava 4 + Jev. "GEV" é **Jev**.
- Callback: frame tem 5 verificações + `send_task_success`, incluindo "Etapa permitida para esta chave? 403" (ausente na análise). O token é "uso único" e "próprio" por etapa; o Gemini diz "amarrado àquela task".
- 7 regras e JSON: ver `correcoes.md` item 8; confirmado.
- O limite de 3 vem do `iter < 3` do ReviewGate (rodadas do Judge), não de "3 tentativas" genéricas.
- O Gemini atribui ao Judge a rejeição por `root_cause` < 20 caracteres e sem evidência; no frame isso é a **validação de schema** (etapa 6), anterior ao Judge.
- Kiro: no frame é `kiro-cli chat --v3 --no-interactive --cloud`; "via Lambda" **[a confirmar]** (o Lambda aparece no estado `waitForTaskToken`).
- Lode: sem Kanban "Triagem/To Do/..." nem "Sentry volta à Triagem" nas telas de regras; orçamento por issue é $200/10 turnos (FP-59) e $1/5 (GLO-41).
- "Claude 3.5 Sonnet": frames mostram `claude-sonnet-5-5` e `claude-opus-5-5`.

## Siglas
- **API:** interface de programação. **ARN:** identificador de recurso da AWS.
- **ASL:** Amazon States Language, a linguagem JSON do AWS Step Functions.
- **AWS:** Amazon Web Services. **SNS:** serviço de notificação da AWS. **SSM:** AWS Systems Manager (Parameter Store guarda o `last-good-sha`).
- **CI:** integração contínua. **PR:** pull request. **SHA / head_sha:** identificador do commit.
- **HTTP 401/403/404/409/429/5xx:** não autorizado / proibido / não encontrado / conflito / excesso de requisições / erro de servidor.
- **JSON:** formato de dados. **YAML:** formato de configuração. **MCP:** protocolo de ferramentas para agentes. **OTLP:** protocolo de telemetria do OpenTelemetry.
- **QA:** controle de qualidade. **TTL/Expires:** prazo de validade. **Jev:** modelo de triagem de ruído (identidade a confirmar).
- **SaaS/PRD:** ver `README.md`.
