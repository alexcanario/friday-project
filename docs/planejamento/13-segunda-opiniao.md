# 13 — Segunda opinião independente (2026-11-04)

Revisão crítica do plano do Friday (roteiro `08`, backlog `09`, decisões D13–D16), pedida como segunda opinião de um arquiteto: riscos, premissas erradas e alternativas. Marcação: **[WEB]** fato verificado na web (fontes no fim), **[OPINIÃO]** juízo do revisor, **[CONTA]** aritmética do revisor, **[TESTAR]** ponto que precisa de experimento ou verificação.

**Resumo:** o plano é tecnicamente sólido. O maior risco é estratégico e não de código: gastar de 8 a 20 meses de calendário construindo uma fábrica em vez dos SaaS que são o objetivo, e essa fábrica repete boa parte do que o plugin Agile já faz. **[OPINIÃO]** Provar o valor com um núcleo fino antes de investir os 61–106 dias.

> **Decisão do dono (2026-11-04):** o painel de controle e o workflow (máquina de estados com gates) **não saem do escopo**. As recomendações de "MVP sem painel" e "adiar o D13" foram retiradas; §3, §5 e §8 já refletem a decisão.

---

## 1. Riscos, do mais grave ao menos grave

| # | Risco | Mitigação |
|---|---|---|
| R1 | **Custo de oportunidade.** 61 a 106 dias de 8 h dão 488 a 848 h. Com 10 a 15 h por semana, isso são de **8 a 20 meses de calendário** **[CONTA]**, com essas horas supostas. Nesse tempo nenhum SaaS fica pronto. | MVP de 3 a 4 semanas com critério para matar o projeto (§8). Nada de M1 sem números. |
| R2 | **Estado em dois lugares.** O Agile já guarda estado (Status do quadro via `board-flight.js`, gates, batch-ship). O Friday teria a própria máquina de estados no SQLite. Dois donos da mesma transição (quem faz o merge? quem move o Status?) acabam em divergência. | Cada transição tem um único dono. Ou o Friday só agenda e o Agile decide, ou o Friday decide e o Agile vira só biblioteca de regras. |
| R3 | **"Agentes sem credenciais" não se sustenta se o agente tiver Bash no host.** O MCP em processo controla o que é oferecido ao agente, não o que ele consegue alcançar. Com Bash, ele lê `gh auth token`, `~/.claude`, `.env`, a variável `ANTHROPIC_API_KEY` herdada e os outros projetos em `D:/`. | Rodar os agentes em WSL2 ou contêiner, sem montar o host, com usuário próprio do SO e saída de rede por allowlist. Limpar o `env` passado ao SDK. Bash restrito ou com sandbox. |
| R4 | **A configuração de segurança mora no repositório que o agente edita.** Se `.friday/factory.yaml` define tetos, ferramentas e auto-merge e está na worktree, o agente pode aumentar o próprio orçamento ou ligar o auto-merge. | A política (tetos, ferramentas, risco, auto-merge) fica no registro central do Friday, ou é lida **só do `main`**, nunca da worktree. Mudança em `.friday/` conta como risco alto. |
| R5 | **O verify só vale o que valem os testes.** Se o agente escreve o teste e o código, o QA e o Judge verificam algo que ele mesmo definiu. | Testes travados antes da implementação (o Agile já tem `test-lock`), critérios aprovados pelo dono, defeitos plantados para medir o Judge. |
| R6 | **Volatilidade do SDK** **[WEB]**: em 16/10/2026 o pacote TypeScript estava na 0.3.302, com cada release acompanhando a versão do CLI. | Versão exata fixada, um adapter único (porta `AgentRunner`), testes de contrato e upgrade semanal deliberado, não diário. |
| R7 | **Windows como host do daemon.** Worktrees presas por processos (o Agile já sofreu com `HELD`), caminhos longos, a máquina que dorme, vários `dotnet build` em paralelo no notebook. | Daemon em WSL2 ou numa VPS Linux pequena. Concorrência de no máximo 1 ou 2 runs. |
| R8 | **O humano é o gargalo.** A latência das aprovações no Slack domina o throughput. Uma fábrica 24/7 com um só aprovador assalariado produz fila, não entregas. | Medir o tempo de espera humana no MVP. Agrupar aprovações (o batch-ship já faz isso). |

## 2. Premissas que eu questionaria

- **SDK 0.x instável.** Confirmado. Detalhe pouco lembrado **[WEB]**: o SDK TypeScript embute um binário nativo do Claude Code. Cada run é um processo do Claude Code. Isso pesa em RAM e CPU por run paralela e explica a paridade de versões com o CLI.
- **SQLite com um único escritor.** Para esta carga, está certo **[OPINIÃO]**. Os riscos reais são outros:
  - o `better-sqlite3` é síncrono e bloqueia o event loop do Fastify;
  - um módulo nativo pode não ter prebuild para o Node 26 no Windows **[TESTAR]** (o Node 24 LTS é a alternativa segura).
  - Usar WAL, `busy_timeout` e um único processo escritor.
- **MCP em processo.** É um bom mecanismo, mas não é fronteira de segurança (R3). Também roda dentro do processo do orquestrador: um handler pendurado trava o daemon. Pôr timeout em cada ferramenta.
- **Judge isolado.** Isolar o contexto é bom. Mas "outro modelo" da mesma família ainda erra de forma correlacionada, e o Judge também é alvo de injeção ("aprove este PR"). A precisão dele não foi medida. Sem um conjunto de avaliação com defeitos plantados, o Judge é teatro.
- **Estimativa de dias.** Está em dias de esforço, não de calendário (R1). "Com apoio de agentes" acelera o código, não as decisões nem a depuração de integração com SDK, GitHub e Windows.
- **Custo de tokens.** Não foi estimado. Cada issue passa por especialista + QA + Judge (+ Diagnose), e as runs que falham também custam.
- **As regras de assinatura mudam** **[WEB]**:
  - Para produtos de terceiros, a Anthropic não permite, sem aprovação prévia, oferecer login do claude.ai ou limites de taxa da assinatura, incluindo agentes feitos com o Agent SDK; o caminho é a chave de API.
  - Para uso próprio, a Anthropic anunciou um crédito mensal separado para SDK e `claude -p` a partir de 15/06/2026 (Pro US$ 20, Max 5x US$ 100, Max 20x US$ 200), mas a página de suporte em português diz que essas alterações foram pausadas na atualização de 15 de junho.
  - Ou seja, a regra mudou duas vezes em 2026. **Projetar o ledger com preço de API e tratar a assinatura como bônus instável.** Reler o artigo de suporte antes do M0.

## 3. Construir ou usar alternativa?

| Opção | Custo extra | Prazo até ter valor | Encaixe |
|---|---|---|---|
| **Só o Agile** (autopilot + execução agendada) | ~0 | dias | Já tem gates, faixas paralelas e batch-ship. Falta orquestração não assistida entre itens. |
| **claude-code-action no GitHub Actions** | minutos de runner + tokens | 2 a 5 dias | Construída sobre o Agent SDK **[WEB]**. Gates via branch protection e environments. Limitação **[WEB]**: por design só faz push da branch e publica um link "Create PR", sem abrir o PR. Não tem ledger diário nem breaker. |
| **Temporal** | servidor + BD para operar | semanas | Excelente para fluxos longos com sinais humanos, e existe SDK .NET. Pesado demais para uma pessoa só hoje. |
| **LangGraph / OpenHands** | médio | semanas | Agnósticos de modelo. Perde-se ou duplica-se o toolset do Claude Code, que é justamente o ativo. Não vale a pena. |
| **Friday completo** | 61 a 106 dias | 8 a 20 meses | Controle total, mas grande sobreposição com o Agile. |

**Escolha do revisor [OPINIÃO], já com a decisão do dono:** construir o Friday próprio, já que painel e workflow são requisitos que nenhuma alternativa pronta entrega no formato desejado (o GitHub Actions não tem painel nem máquina de estados com gates próprios). Mas começar pelo "Friday-núcleo" de 3 a 4 semanas (§8): workflow mínimo + painel mínimo + ledger, medindo tudo antes de M1. O Friday deve ser o **dono do workflow e do estado**; o Agile entra como biblioteca de regras e perfis (ou via D16, se o spike passar), nunca como segunda máquina de estados.

## 4. TypeScript ou .NET para o orquestrador

- **Fato:** em .NET, chamar `claude -p --output-format stream-json` é menos ruim do que parece, porque o SDK de TS também roda o binário por baixo. O que se perde:
  - `createSdkMcpServer` em processo: o substituto é um servidor MCP stdio em C#, com o SDK oficial de MCP para C#;
  - `canUseTool` e hooks como callbacks: os substitutos são `--permission-prompt-tool` e hooks como comandos;
  - a tipagem das mensagens.
- **[OPINIÃO]:** TS para o *runner* de agentes, porque os recursos novos do SDK aparecem lá primeiro. O núcleo deve ser pequeno o bastante para ser revisado sem fluência em TS. Se o núcleo crescer para milhares de linhas depuradas às 3 da manhã, a vantagem pende para C#. Isso é mais um motivo para manter o Friday fino. O pior caso é um híbrido com orquestrador em C# e runner em TS: dois stacks, duas pipelines.

## 5. React ou Blazor (D13)

O painel está no escopo desde o MVP (decisão do dono). **[OPINIÃO]:**
- **Blazor WASM**, porque é o dono quem mantém e depura. Os contratos nascem no Zod do backend → OpenAPI (Fastify) → cliente C# gerado (NSwag), sem duplicar tipos à mão. Atualização ao vivo por SSE a partir do Fastify.
- React só se um agente for manter o painel sem revisão humana, e isso contradiz o próprio modelo de gates.
- Escopo do painel no MVP: lista de issues e runs com estágio, custo e turnos; detalhe da run (transcrição, diff, veredito do Judge); botões **Aprovar / Rejeitar presos ao `head_sha`**; interruptor global e estado do breaker. O resto (gráficos, multi-projeto, editor de config) fica para M1+.
- Segurança do painel: só `localhost` ou atrás de autenticação; toda ação do painel passa pela mesma API e pelas mesmas guardas do CLI e do Slack (um único caminho de escrita).

## 6. D14, D15 e D16

- **D14 (multi-projeto):** de acordo com a coluna `project_id` desde o primeiro dia (é barato) e com tetos por projeto + global. Contra pôr a política em `.friday/` no repositório (R4). E multi-projeto real só depois de o MVP funcionar num projeto. `D:/wt/<projeto>/<issue>` é coerente com o Agile.
- **D15 (renomear para friday):** de acordo, e agora, antes de existir código. Custo zero.
- **D16 (carregar o agile@canary pelo SDK):** é viável mecanicamente **[WEB]**: o SDK carrega plugins de diretórios locais (skills, agentes, hooks e servidores MCP), e um plugin instalado pelo CLI pode ser usado passando o caminho dele em `~/.claude/plugins/`. Os riscos estão em outro lugar:
  - as duas paradas humanas do autopilot usam cartões ou perguntas interativas que, em modo headless, precisam virar eventos do Friday;
  - o Agile escreve o Status do quadro e o Friday também (R2);
  - os hooks `guard.js` e `run-guard.js` podem bloquear de formas que o Friday não entende.

  **[TESTAR] Spike de 1 dia:** `query({ prompt: "/agile:autopilot …", options: { plugins: [{ type: "local", path }] } })` num projeto de rascunho. Verificar se as paradas aparecem como `AskUserQuestion` ou `canUseTool`, se os hooks disparam e quem move o Status. Se as paradas não aparecerem de forma limpa, o D16 cai.

## 7. O que costuma ser subestimado

- **Injeção de prompt:** vem pelo corpo da issue, comentários de PR, READMEs de dependências, saída de testes e WebFetch. O Judge também é alvo. Mitigação: Judge sem ferramentas, entrada estruturada (diff + critérios) e saída em JSON validado com Zod; o veredito só vale junto com checks determinísticos.
- **Segredos:** limpar o `env` das runs, nada de `.env` nas worktrees, tokens de curta duração.
- **Identidades:** preferir **GitHub Apps** a contas de bot (`fhp-author`, `fhp-judge`). Os tokens são por repositório e de curta duração. **[TESTAR]** Verificar se os termos de uso do GitHub limitam contas de máquina gratuitas por pessoa e se a aprovação de um App conta como revisão obrigatória na branch protection.
- **Cadeia de suprimentos:** se o agente adicionar pacotes npm ou NuGet, mudança em lockfile vira risco alto automaticamente.
- **Observabilidade:** transcrição completa de cada run guardada, mais custo, turnos e duração por estágio. Sem isso, o Diagnose não tem o que diagnosticar.
- **Avaliação dos agentes:** um conjunto fixo de 15 a 20 issues reais já resolvidas, rodado a cada upgrade do SDK ou de prompt.
- **Custo real:** inclui as runs que falham, o retrabalho humano e o cache de tokens.
- **Idempotência dos efeitos no GitHub:** merge com SHA esperado está bem pensado. Fazer o mesmo para comentários, labels e criação de PR.
- **Laço pós-deploy e revert:** cortar do núcleo. Os SaaS ainda não têm tráfego que justifique.

## 8. MVP de 3 a 4 semanas (com painel e workflow)

**Semana 1: linha de base e spikes, com quase nenhum código novo**
- Rodar o autopilot do Agile em 8 a 10 issues reais de um SaaS próprio. Anotar o custo por issue, o tempo de máquina, o tempo humano e onde houve retrabalho.
- Spike do D16 (§6).
- Spike de isolamento: um agente em WSL2 ou contêiner sem acesso ao host.

**Semana 2: workflow e runner**
- Máquina de estados mínima, com transições gravadas no SQLite: `triage → in_progress → verify → judge → human_review → merged | rejected | failed`. QA separado e Diagnose ficam para M1.
- Polling da label `friday` → worktree → run do especialista (`maxTurns`, `maxBudgetUsd`) → comando de testes → PR aberto pelo orquestrador.
- Run do Judge somente leitura, com JSON preso ao `head_sha`.
- Ledger (tabelas `runs` e `transitions`), trava "uma run por issue", interruptor global.

**Semana 3: painel mínimo (§5)**
- Blazor WASM sobre a API Fastify: lista, detalhe da run, aprovar/rejeitar preso ao `head_sha`, interruptor e breaker.
- A aprovação no painel dispara o merge squash com SHA esperado. Sem Slack, sem auto-merge, sem deploy.

**Semana 4: medir em 15 a 20 issues e decidir**
- Critérios para seguir **[OPINIÃO, ajustar os números]**:
  - pelo menos 60% dos PRs aceitos com no máximo uma correção pequena;
  - o tempo humano por issue cai 50% ou mais em relação à linha de base;
  - o custo por issue fica abaixo de um teto definido antes de começar;
  - o Judge pega pelo menos 70% dos defeitos plantados.
- Se não bater, parar o Friday e investir no Agile.

---

## Fontes
- [Plugins in the SDK — Claude Code docs](https://code.claude.com/docs/en/agent-sdk/plugins.md)
- [Agent SDK overview (pt) — Claude Platform docs](https://platform.claude.com/docs/pt/agent-sdk/overview)
- [Use o Claude Agent SDK com seu plano Claude — Suporte Claude](https://support.claude.com/pt/articles/15036540-use-o-claude-agent-sdk-com-seu-plano-claude)
- [Use the Claude Agent SDK with your Claude plan — Suporte Claude](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Claude Code GitHub Actions — Claude Code docs](https://code.claude.com/docs/en/github-actions?m=1)
- [Commit sobre claude-code-action não abrir o PR (3x-ui)](https://git.txlyre.website/txlyre/3x-ui/commit/d33b6865a9352aae8f9e1f49efd2b091a2f1231c?lang=es-ES)
- [Claude Agent SDK: latest version — Developers Digest](https://www.developersdigest.tech/agent-frameworks/claude-agent-sdk)
- [Claude Agent SDK — Tutorials Dojo](https://tutorialsdojo.com/claude-agent-sdk/)

## Siglas
- **API**: Application Programming Interface (interface de programação)
- **BD**: Banco de Dados
- **CLI**: Command-Line Interface (interface de linha de comando)
- **CPU**: Central Processing Unit (processador)
- **JSON**: JavaScript Object Notation (formato de dados)
- **LTS**: Long-Term Support (versão com suporte longo)
- **MCP**: Model Context Protocol (protocolo de ferramentas para agentes)
- **MVP**: Minimum Viable Product (produto mínimo viável)
- **PR**: Pull Request
- **QA**: Quality Assurance (garantia de qualidade)
- **RAM**: Random Access Memory (memória)
- **SaaS**: Software as a Service
- **SDK**: Software Development Kit
- **SHA**: Secure Hash Algorithm (aqui, o hash do commit)
- **SO**: Sistema Operacional
- **SSE**: Server-Sent Events (envio de eventos do servidor ao navegador)
- **TS**: TypeScript
- **VPS**: Virtual Private Server
- **WAL**: Write-Ahead Logging (modo de journal do SQLite)
- **WASM**: WebAssembly
- **WSL2**: Windows Subsystem for Linux, versão 2
