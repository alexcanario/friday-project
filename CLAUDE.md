# friday-project

Friday is an agentic software-factory orchestrator (TypeScript + Claude Agent SDK): issues are refined, implemented, reviewed, tested and merged by agents, with humans only at the gates. This repository is built **by** a nightly agent loop that follows the same process Friday will automate.

Owner: Alex (pt-BR). Current decisions: `docs/decisoes.md`. Process: `docs/processo.md`. Night runbook: `docs/noite.md`. Schedule: `docs/cronograma.md`. Planning sources (read only the section an issue cites): `docs/planejamento/`.

## Language
- Talk to the owner in pt-BR. Docs the owner reads (`docs/*.md`, issue `## Resumo`, night reports) are pt-BR.
- Code, identifiers, commits, branch names, PR titles and test names are English.
- Every pt-BR doc that uses an acronym ends with a `## Siglas` section.

## Stack (decided)
- Node 26, TypeScript strict, pnpm workspaces, Vitest, ESLint + Prettier, Zod 4, Fastify, better-sqlite3 + Drizzle, `@anthropic-ai/claude-agent-sdk` pinned to an exact version.
- Panel: Blazor WASM consuming the Fastify API through an OpenAPI-generated C# client (D13, pending owner confirmation in issue "Decidir D13").
- Layers (`docs/planejamento/08-roteiro-implementacao.md` §3.4): `domain` (pure, no I/O) → `application` (ports) → `infrastructure` (adapters) → `apps` (daemon, cli, api). Domain never imports infrastructure.
- Naming (D15): `friday` everywhere — package scope `@friday/*`, CLI `friday`, MCP tools `mcp__friday__*`, config `.friday/`. Never `fhp` in new code.

## Status lives in labels
- Exactly one `status:*` label per open issue: `backlog` → `ready` → `in-progress` → `review` → (closed) or `needs-human` / `blocked`. A GitHub Action mirrors it to the Project field "Estado". Never touch the Project directly (GraphQL is not available to cloud sessions).
- Gate labels stop the merge for the owner: `gate:business`, `gate:security`, `gate:budget`, `gate:screen`. Everything else that the AI validated (CI green + QA + Judge approve) merges without a human.
- `owner-action` issues are done by the owner only; agents skip them.

## Rules
- Tests come first: the `## Criterion → test` table of the issue is written at refinement and its tests are committed before the implementation.
- One issue = one branch `friday/<issue>-<slug>` from `develop` = one PR with `Closes #<issue>`. Squash merge with the expected head SHA.
- Never retry blindly: a red check gets at most 2 targeted fixes per night; then `status:needs-human` + `gate:budget` with a diagnosis.
- Never commit secrets, `.env` files or tokens. Security policy (budgets, tool permissions, auto-merge) is never read from a worktree; only from `develop` or the central registry (analysis R4, `docs/planejamento/13-segunda-opiniao.md`).
- Agent tool permissions, budget code, auth, tokens or anything under `.github/workflows` touched by a PR ⇒ add `gate:security` (or `gate:budget` for caps/ledger).
- Changes visible in the panel ⇒ `gate:screen`. A business rule or an ambiguous requirement ⇒ `gate:business` with the question written in the issue.
- Economy: read only the files the issue lists plus what a failing test points to; no repo-wide exploration. Use the subagents in `.claude/agents/` (each declares its model) instead of doing their work in the main session.
- Keep files small: a source file ≤ 300 lines, a function ≤ 50 lines.

## Done
CI green (typecheck, lint, test) · every criterion has a passing test · QA and Judge verdicts posted on the PR bound to the head SHA · issue closed by the squash merge · no new `TODO` without an issue.
