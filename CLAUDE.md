# friday-project

Friday is an agentic software-factory orchestrator (TypeScript + Claude Agent SDK): issues are refined, implemented, reviewed, tested and merged by agents, with humans only at the gates. This repository is built **by** a nightly agent loop that follows the same process Friday will automate.

Owner: Alex (pt-BR). Current decisions: `docs/decisions.md`. Process: `docs/process.md`. Night runbook: `docs/night.md`. Schedule: `docs/schedule.md`. Planning sources (read only the section an issue cites): `docs/planning/`.

## Language (hybrid, D21)
- **English:** code, identifiers, variables, file and folder names, branch names, test names, log messages, JSON keys, config keys, and the instructions in `.claude/` and `CLAUDE.md`.
- **pt-BR:** conversations with the owner, commit messages (Conventional Commits prefix stays English: `feat: adiciona máquina de estados (#13)`), PR titles and bodies, issue titles and bodies, comments on issues and PRs, night reports, `docs/`, and any text shown to a user (panel, CLI output, error messages).
- JSON produced by agents: keys in English, free-text values in pt-BR.
- Every pt-BR doc that uses an acronym ends with a `## Siglas` section.

## Stack (decided)
- Node 26, TypeScript strict, pnpm workspaces, Vitest, ESLint + Prettier, Zod 4, Fastify, better-sqlite3 + Drizzle, `@anthropic-ai/claude-agent-sdk` pinned to an exact version.
- Panel: React + Vite + TanStack Query in `apps/web`, served by the Fastify API, importing the Zod schemas from `packages/contracts` directly (D80, replaces D13).
- Layers (`docs/planning/08-implementation-roadmap.md` §3.4): `domain` (pure, no I/O, no external dependencies) → `application` (ports) → `infrastructure` (adapters) → `apps` (daemon, cli, api, web). Domain never imports infrastructure. `packages/contracts` holds the Zod schemas (D23) and is imported by `application` and `apps/web`, never by `domain`.
- Naming (D15): `friday` everywhere — package scope `@friday/*`, CLI `friday`, MCP tools `mcp__friday__*`, config `.friday/`. Never `fhp` in new code.

## Status lives in labels
- Exactly one `status:*` label per open issue: `backlog` → `ready` → `in-progress` → `review` → (closed) or `needs-human` / `blocked`. A GitHub Action mirrors it to the Project field "Estado". Never touch the Project directly (GraphQL is not available to cloud sessions).
- Gate labels stop the merge for the owner: `gate:business`, `gate:security`, `gate:budget`, `gate:screen`. Everything else that the AI validated (CI green + QA + Judge approve) merges without a human.
- `owner-action` issues are done by the owner only; agents skip them. Issue #1 (`type:report`) has no `status:*` and only receives night reports.

## Rules
- Tests come first: the `## Criterion → test` table of the issue is written at refinement and its tests are committed before the implementation.
- One issue = one branch `friday/<issue>-<slug>` from `develop` = one PR with `Closes #<issue>`. Squash merge with the expected head SHA.
- Never retry blindly: a red check gets at most 2 targeted fixes per night; then `status:needs-human` + `gate:budget` with a diagnosis.
- Never commit secrets, `.env` files or tokens. Security policy (budgets, tool permissions, auto-merge) is never read from a worktree; only from `develop` or the central registry (analysis R4, `docs/planning/13-second-opinion.md`).
- Agent tool permissions, budget code, auth, tokens or anything under `.github/workflows` touched by a PR ⇒ add `gate:security` (or `gate:budget` for caps/ledger).
- Changes visible in the panel ⇒ `gate:screen`. A business rule or an ambiguous requirement ⇒ `gate:business` with the question written in the issue.
- Economy: read only the files the issue lists plus what a failing test points to; no repo-wide exploration. Use the subagents in `.claude/agents/` (each declares its model) instead of doing their work in the main session.
- Lessons for the sibling plugins (agile@canary, legacy-lens), **only when needed** — a real bug, gap or improvement seen while working, never speculation: append a `⏳ plugin: agile|lens [<scope>]` note to `docs/agile/retro-log.md` (row in "Plugin notes — status" + dated entry, English, no secrets). Never write in those repositories; the same lesson twice stays one row.
- Keep files small: a source file ≤ 300 lines, a function ≤ 50 lines.

## Done
CI green (typecheck, lint, test) · every criterion has a passing test · QA and Judge verdicts posted on the PR bound to the head SHA · issue closed by the squash merge · no new `TODO` without an issue.
