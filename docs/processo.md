# Processo de trabalho do friday-project

Como uma issue vai da ideia ao merge, quem decide cada passo e onde o humano entra. A execução noturna está em [`noite.md`](noite.md); os diagramas, em [`diagramas.md`](diagramas.md).

## 1. Papéis
| Papel | Quem | O que faz |
|---|---|---|
| Dono | Alex | Prioriza, responde os gates, faz as `owner-action`, decide o go/no-go. ~1 h/dia. |
| Orquestrador | sessão agendada do Claude Code na nuvem | Escolhe as issues, chama os subagentes, aplica as regras, escreve labels e relatório. |
| Refinador | subagente `refiner` (Sonnet) | Transforma a issue em item pronto: critérios testáveis, tabela critério → teste, gates. |
| Implementador | subagente `implementer` (Sonnet) | Testes primeiro, código, CI local, PR. |
| QA | subagente `qa` (Sonnet, só leitura) | Confere cada critério contra um teste real e o CI. |
| Judge | `judge` (Sonnet) ou `judge-strong` (Opus, só com gate ou risco ≥ medium) | Revisão independente, veredito preso ao `head_sha`. |
| Relator | subagente `reporter` (Haiku) | Relatório da manhã em pt-BR. |

## 2. Estados (labels `status:*`)
Uma issue aberta tem exatamente um `status:*`. Uma GitHub Action espelha esse estado no campo **Estado** do GitHub Project.

| Label | Estado no Project | Entra quando | Sai quando |
|---|---|---|---|
| `status:backlog` | Backlog | issue criada | refinada |
| `status:ready` | Ready | refinador terminou sem gate de negócio | o implementador pega |
| `status:in-progress` | In progress | branch criada | PR aberto |
| `status:review` | In review | PR aberto | QA + Judge + CI decidem |
| `status:needs-human` | Needs you | gate, estouro de teto ou dúvida | o dono responde |
| `status:blocked` | Blocked | dependência aberta ou falha externa | a dependência fecha |
| (fechada) | Done | merge squash com `Closes #n` | — |
| (fechada como *not planned*) | Discarded | dividida em sub-issues ou descartada | — |

## 3. Definition of Ready
- Corpo no formato do `refiner` (Resumo, Escopo, Critérios, Criterion → test, Arquivos, Risco e gates, Depende de, Tamanho).
- Cada critério é verificável por teste ou comando.
- Tamanho S ou M (cabe numa noite). L é dividida.
- Dependências fechadas ou na mesma noite antes desta.

## 4. Definition of Done
CI verde (typecheck, lint, test) · todo critério com teste passando · vereditos de QA e Judge publicados no PR para o `head_sha` final · merge squash fecha a issue · nenhum `TODO` novo sem issue.

## 5. Gates: quando o humano é necessário
O que a IA validou **não volta para validação humana**, exceto nos quatro gates escolhidos pelo dono:

| Gate | Dispara quando | O que o dono faz |
|---|---|---|
| `gate:business` | regra de negócio, requisito ambíguo, decisão de produto | responde a pergunta na issue e muda para `status:ready` |
| `gate:security` | permissões de agente, tokens, auth, injeção, `.github/workflows`, isolamento | lê as linhas apontadas pelo `judge-strong` e faz o merge (ou pede mudança) |
| `gate:budget` | estouro de teto: mais de 2 correções, CI vermelho persistente, issue que não coube na noite, código de tetos/ledger | decide: dividir, reescrever o critério ou liberar mais uma noite |
| `gate:screen` | qualquer mudança visível no painel | roda o painel localmente, confere a tela e faz o merge |

Sem gate: CI verde + QA `pass` + Judge `approve` no mesmo `head_sha` ⇒ **merge automático em `develop`**.

## 6. Prioridade
Ordem de escolha: milestone mais antigo aberto → `prio:1` → `prio:2` → `prio:3` → número da issue. O dono reordena trocando `prio:*` (o quadro do Project é só para leitura: a noite não lê a ordem dele).

## 7. Rotina do dono (~1 h/dia)
1. **Manhã (10 min):** ler o comentário da noite na issue fixada **Relatório noturno**.
2. **Gates (30–40 min):** coluna *Needs you* do Project. Responder ou fazer o merge dos itens com gate.
3. **Planejar (10 min):** ajustar `prio:*`, fechar `owner-action`, criar ideias novas como `status:backlog` (não precisa refinar: a noite refina).

## 8. Branches
- `develop`: integração, recebe os merges automáticos.
- `main`: releases, merge manual do dono ao fim de cada milestone.
- `friday/<n>-<slug>`: uma por issue, apagada após o merge.

## Siglas
- **CI:** Continuous Integration, build e testes automáticos a cada push.
- **PR:** Pull Request, proposta de mudança no GitHub.
- **QA:** Quality Assurance, verificação de qualidade.
- **SHA:** Secure Hash Algorithm; aqui, o identificador do commit.
