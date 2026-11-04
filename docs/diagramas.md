# Diagramas do fluxo

O GitHub renderiza os diagramas Mermaid direto nesta página.

## 1. Visão geral: dia do dono e noite dos agentes
```mermaid
flowchart LR
    subgraph Dia["Dia · dono ~1 h"]
        R[Lê o relatório noturno] --> G[Responde os gates<br/>coluna Needs you]
        G --> P[Ajusta prio:* e cria ideias<br/>status:backlog]
    end
    subgraph Noite["Noite · tarefas agendadas na nuvem"]
        A["A · 23:41 Refinar<br/>refiner (Sonnet)"] --> B["B · 01:23 Implementar<br/>implementer (Sonnet)"]
        B --> C["C · 05:17 QA + Judge + merge<br/>qa, judge / judge-strong"]
        C --> RP["Relatório<br/>reporter (Haiku)"]
    end
    P --> A
    RP --> R
    C -- "sem gate e tudo verde" --> M[(merge em develop)]
    C -- "com gate ou estouro" --> G
```

## 2. Estados de uma issue (labels `status:*`)
```mermaid
stateDiagram-v2
    [*] --> backlog
    backlog --> ready: refinada (fase A)
    backlog --> needs_human: gate:business com pergunta
    backlog --> [*]: tamanho L → dividida em sub-issues
    needs_human --> ready: dono respondeu
    ready --> in_progress: fase B pega
    ready --> blocked: dependência aberta
    blocked --> ready: dependência fechou
    in_progress --> review: PR aberto
    in_progress --> needs_human: falhou 2× (gate:budget)
    review --> done: CI + QA + Judge ok e sem gate
    review --> needs_human: gate ou estouro de teto
    needs_human --> done: dono faz o merge
    done --> [*]
```

## 3. Decisão de merge na fase C
```mermaid
flowchart TD
    S([PR em status:review]) --> CI{CI verde<br/>no head_sha?}
    CI -- não --> F1[1 correção pelo implementer] --> CI2{verde?}
    CI2 -- não --> NB[needs-human + gate:budget]
    CI2 -- sim --> QA
    CI -- sim --> QA{QA pass?}
    QA -- não --> F2[1 rodada de correção] --> QA2{pass?}
    QA2 -- não --> NB
    QA2 -- sim --> J
    QA -- sim --> J{gate ou risco ≥ medium?}
    J -- sim --> JS[judge-strong · Opus]
    J -- não --> JN[judge · Sonnet]
    JS --> V{approve?}
    JN --> V
    V -- não --> NB
    V -- sim --> GT{tem gate:*?}
    GT -- sim --> NH[needs-human<br/>resumo do Judge para o dono]
    GT -- não --> MG[merge squash com sha = head_sha<br/>issue fecha]
```

## 4. Sequência de uma issue numa noite
```mermaid
sequenceDiagram
    autonumber
    participant O as Orquestrador (sessão agendada)
    participant GH as GitHub REST
    participant RF as refiner
    participant IM as implementer
    participant QA as qa
    participant JD as judge
    participant ACT as Action project-sync
    O->>GH: lista status:backlog (prioridade)
    O->>RF: refina #n
    RF-->>O: corpo + labels (JSON)
    O->>GH: PATCH issue, status:ready
    GH-->>ACT: evento labeled
    ACT->>ACT: Estado = Ready no Project
    O->>IM: implementa #n
    IM->>GH: branch, testes, código, PR "Closes #n"
    IM-->>O: pr-opened, head_sha
    O->>GH: status:review
    O->>GH: espera o CI do head_sha
    O->>QA: revisa o PR
    QA-->>O: pass
    O->>JD: julga o PR
    JD-->>O: approve (head_sha)
    O->>GH: PUT merge (sha = head_sha)
    GH-->>ACT: issue fechada
    ACT->>ACT: Estado = Done
```

## 5. Espelho label → GitHub Project
```mermaid
flowchart LR
    E["evento da issue<br/>opened · labeled · unlabeled · closed · reopened"] --> W[Action project-sync.yml]
    W --> T{"label status:* atual<br/>(ou fechada)"}
    T --> GQL["GraphQL com PROJECT_TOKEN<br/>addProjectV2ItemById<br/>updateProjectV2ItemFieldValue"]
    GQL --> PJ[("Project 'Friday'<br/>campo Estado")]
```

## Siglas
- **CI:** Continuous Integration.
- **PR:** Pull Request.
- **QA:** Quality Assurance.
- **REST:** Representational State Transfer, estilo de API HTTP.
- **SHA:** Secure Hash Algorithm; aqui, o identificador do commit.
