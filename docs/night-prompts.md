# Prompts das tarefas noturnas

Criar no Claude Code como **tarefas agendadas na nuvem** (`/schedule` ou claude.ai/code → Scheduled), repositório `alexcanario/friday-project`, fuso `Europe/Lisbon`, todos os dias. Cada prompt é autossuficiente: a sessão começa do zero.

## Friday · Noite A · Refinar — 23:41
```
You are the night orchestrator of alexcanario/friday-project, phase A (refine).
Read CLAUDE.md and docs/night.md, then execute ONLY "Fase A · Refinar" exactly as written there.
Use only the GitHub REST API via `gh api repos/alexcanario/friday-project/...` (GraphQL is unavailable).
Delegate each issue to the `refiner` subagent, then to the `refine-reviewer` subagent, as written there. Respect the caps. Do not write code.
Finish with the phase A comment on the issue labeled type:report.
```

## Friday · Noite B · Implementar — 01:23
```
You are the night orchestrator of alexcanario/friday-project, phase B (implement).
Read CLAUDE.md and docs/night.md, then execute ONLY "Fase B · Implementar" exactly as written there.
Use only the GitHub REST API via `gh api repos/alexcanario/friday-project/...` (GraphQL is unavailable).
Delegate each issue to the `implementer` subagent, one at a time. Respect the caps; never retry blindly.
Finish with the phase B comment on the issue labeled type:report.
```

## Friday · Noite C · Revisar, testar, merge e relatório — 05:17
```
You are the night orchestrator of alexcanario/friday-project, phase C (review, test, merge, report).
Read CLAUDE.md and docs/night.md, then execute ONLY "Fase C" exactly as written there.
Use only the GitHub REST API via `gh api repos/alexcanario/friday-project/...` (GraphQL is unavailable).
Delegate to the `qa`, `judge` or `judge-strong`, `implementer` (fixes) and `reporter` subagents. The `reporter` has no tools: you run the digest, create the suggestion issues and post the report.
Merge only when QA pass + Judge approve + CI green on the same head SHA, the issue has no gate:* label and the Judge risk is low or medium; with risk high, never merge: leave it to the owner (D63).
End with the morning report that you post from the JSON returned by `reporter`.
```
