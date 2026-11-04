# Pacotes de método: como o Friday hospeda o Agile e o Lens (D22)

O Friday é **um motor** (fila, noite, estado, gates, tetos, painel). O Agile e o Lens viram **pacotes de método** que o motor carrega por projeto. Nenhum dos dois vira código do Friday. Fontes: `agile@canary` 0.289.0 (`1b55ce21`) e `legacy-lens` 0.18.0 (`7069af4`), lidos em 2026-11-04.

## 1. Camadas
| Camada | Quem | Conteúdo |
|---|---|---|
| Motor (um só) | Friday | fila, agendamento, worktrees, isolamento, ledger e tetos, breaker, máquina de estados, gates, painel, sync com o GitHub, métricas, multi-projeto |
| Pacote de método | `agile` (construir), `lens` (adotar legado) | fases internas, agentes, regras, referências, política de gates, templates |
| Perfil de stack | dentro do pacote | `web-app`, `web-api`, `microservices`, `modular-monolith`, `vs-extension`, `adopted`… |
| Ferramenta determinística | chamada pelas fases | `lens-dotnet` (`map`, `guard`, `candidates`, `link`, `report`, `ledger explain`) |
| Projeto | registro do Friday | `method`, `profile`, tetos, gates extras, repositórios relacionados |

## 2. Ponto de extensão
A máquina de estados do Friday é fixa: `triage → ready → in_progress → verify → judge → human_review → merged`. Um pacote declara:
- **fases** dentro do `in_progress` (lista ordenada; cada fase tem um papel/agente, entradas, saídas e se é determinística);
- **política de gates** (quais condições levam a `human_review` e com que label);
- **perfis** e **regras** copiados para o worktree da run.

Um pacote nunca cria um estado novo do motor.

## 3. O que o Lens é de fato
Fatos do repositório (relatório de leitura de 2026-11-04):
- O Lens faz **só descoberta e adoção**. A entrega (itens, gates, review, ship) é do Agile, com o perfil `adopted`.
- O núcleo é o **`lens-dotnet`**, uma ferramenta global .NET 10 que lê árvores Roslyn e XML de projeto, sem build. É determinística: cada item tem evidência `file:line`, confiança e origem. A saída fica em `docs/legacy/inventory/*.json`, validada por `schema/inventory.schema.json`, mais o `ledger.json`.
- Partes interativas com o dono: a rodada de adoção A1–A6 (+ M1–M4 migração, S1 seam), as declarações em `docs/legacy/lens.json` (checagens de permissão, pastas, repositórios relacionados), a classificação de diferenças no ledger e a autorização de commit.
- Regras que vão para o repositório adotado: `migration-rule.md` (decisão aberta para a épica; folhas primeiro; fatia pronta só com consumidores redirecionados e código antigo removido) e `seam-rule.md` (wrappers são a allowlist; nada de regra de negócio no seam; teste de arquitetura obrigatório).
- **Ainda não existe** ferramenta de testes de caracterização, golden master ou paridade, nem classificação de risco legível por máquina. As áreas não confiáveis "ganham um teste de caracterização antes de mudar, ou uma nota escrita".

## 4. Pacote `agile` (greenfield e entrega)
| Fase em `in_progress` | Papel | Origem |
|---|---|---|
| design (só itens de contrato, schema ou API) | `system-design` (Opus) | agente do Agile |
| testes de aceite travados | `test-writer` | agente + `test-lock.md` |
| implementação | `backend` / `frontend` / `ui-kit` conforme a área | agentes do Agile |
| revisão de segurança (com `gate:security`) | `security` | agente do Agile |

Gates: negócio, segurança, teto e tela (D18). As partes interativas do Agile (discovery, quiz de bootstrap, `screen-design`, `visual-identity`, release) continuam como sessões com o dono.

## 5. Pacote `lens` (legado)
Dois fluxos:

**Adoção (uma vez por repositório):**
| Passo | Tipo | Onde roda |
|---|---|---|
| `lens-dotnet map` + `report` | determinístico, sem LLM | noite (contêiner com .NET 10) |
| `lens-dotnet guard` / `candidates` / `link` | determinístico | noite |
| declarações em `lens.json`, rodada A1–A6/M/S | **dono** | `human_review` com `gate:business` (sessão interativa) |
| escrita de perfil, ADR, regras de migração/seam | agente + commit autorizado | noite, depois da resposta do dono |

**Mudança no legado (por issue):** usa as fases do pacote `agile` com o perfil `adopted`, mais:
| Fase extra | Regra |
|---|---|
| **caracterizar** antes de implementar, se a área não tem testes confiáveis (A5) | teste de caracterização ou nota escrita; sem isso, não há merge automático |
| **re-map** depois da mudança | `lens-dotnet map` + `ledger`; diferença de contagem ⇒ `human_review` para o dono classificar (fix, regressão ou mudança de código) |
| **guard** | operação sem checagem no servidor nunca vira ferramenta; credencial no código ⇒ `gate:security` primeiro |
| **fatia de migração** | só está pronta com os consumidores redirecionados e o código antigo removido (`migration-rule.md`) |

Política de gates do `lens`: a do `agile`, mais `gate:business` para toda diferença do ledger e para regra de negócio inferida do legado, e risco um nível acima em código sem testes de caracterização.

## 6. Caminho de absorção
1. **MVP (até 06/12):** o motor já prevê as fases plugáveis (#13) e as colunas `method` e `profile` (#14). Nenhum pacote é carregado.
2. **Piloto Agile:** um projeto do Agile rodando no Friday, com o plugin carregado pelo SDK (spike #10) ou com as fases copiadas.
3. **Piloto Lens:** a adoção de um legado (NX ou Toolbox) com o `lens-dotnet` rodando à noite e as declarações como gates.
4. **Extração:** `packs/agile/` e `packs/lens/`, versionados e lidos como dado (Markdown, JSON e schemas). O `lens-dotnet` continua como ferramenta externa.
5. **Aposentadoria:** as partes de execução dos plugins (autopilot, resolve, parallel-build, batch-ship, sync de quadro) são marcadas como obsoletas e removidas depois de 4 a 8 semanas de uso real do Friday. As sessões interativas continuam no Claude Code.

## 7. Lacunas do Lens (registradas como notas ⏳ em `docs/agile/retro-log.md`)
- uma ferramenta de testes de caracterização ou golden master;
- um modo headless para a parte não interativa da adoção;
- uma política de risco e gates legível por máquina.

## Siglas
- **ADR:** Architecture Decision Record, registro de decisão de arquitetura.
- **API:** Application Programming Interface.
- **JSON:** JavaScript Object Notation.
- **LLM:** Large Language Model, modelo de linguagem.
- **MVP:** Minimum Viable Product, produto mínimo viável.
- **NX:** aplicação legada da Abreu (cliente WPF + nxweb).
- **SDK:** Software Development Kit.
