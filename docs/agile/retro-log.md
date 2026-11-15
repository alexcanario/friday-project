# Retro log

Lessons for the sibling plugins, in the format their own sessions take in (agile@canary `references/retro-log-entry.md`; lens: a session in its repository captures each note with `/agile:idea`). Friday sessions only append here; they never write in the agile-canary or legacy-lens repositories. Each plugin's session reads its ⏳ rows, opens the item on its own board, and lists it as delivered; the row is then marked ✅ here by a friday-project session. Notes are in English (messages between sessions).

## Plugin notes — status
| Status | Plugin | Note | From | Plugin version |
|---|---|---|---|---|
| ✅ Control-Alt-Sistems/lens#76 (F-47) | lens | No characterization/golden-master tooling: changes to untrusted legacy areas have only a written-note fallback | 2026-11-04 method-packs review | 0.18.0 |
| ✅ already delivered, Control-Alt-Sistems/lens#48 (F-31) | lens | No headless mode for the non-interactive part of adoption (map, guard candidates, report) | 2026-11-04 method-packs review | 0.18.0 |
| ✅ Control-Alt-Sistems/lens#77 (F-48) | lens | No machine-readable risk and gate policy an orchestrator can apply | 2026-11-04 method-packs review | 0.18.0 |
| ⏳ | agile | No host mode: an external orchestrator cannot turn off board writes, merge and ship and keep only the phases up to `validating` | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Merge method is fixed to merge commits; a host requiring squash with an expected head SHA cannot use the ship | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Autonomy policy is read from the project's own CLAUDE.md, editable from an item branch; it needs a source outside the worktree | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Autonomy is binary (owner or Claude): no named decider per category, no "both", no presets | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | The bootstrap quiz never writes autonomy, priority or cadence, gate rigor, team members or an agent budget | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Resolve accepts only issues written by the `gh api user` login: no several humans, no agent login | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Review verdict is a Markdown table, not a machine-readable verdict bound to the head SHA | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Events are Markdown lines with no decider identity, so a host cannot measure agreement per human | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Repository text is English-only; a hybrid language rule cannot be configured | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Branch names are fixed to `feature/F-<n>` / `bug/B-<n>`, with no host-provided pattern | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | Board state goes through Projects GraphQL, with no label-only mode | 2026-11-15 D111 review | 0.317.0 |
| ⏳ | agile | No profile, skeleton or gate for a Node/TypeScript (pnpm) stack | 2026-11-15 D111 review | 0.317.0 |

## To check

## 2026-11-04 — method-packs review (docs/method-packs.md, D22)
- ✅ plugin: lens [characterization] (lens#76) — An orchestrator hosting lens needs a deterministic way to lock current behaviour before a change: a characterization or golden-master step (inputs → recorded outputs, compared after the change), callable headless. Today `adoption-questions.md` A5 only allows "a characterization test or a written note".
- ✅ plugin: lens [headless] (delivered by lens#48; its headless mode does not run `candidates`, by decision of F-31, and no item was opened for that) — `/lens:adopt` must run interactively. Split it so the deterministic steps (`lens-dotnet map`, `guard`, `candidates`, `link`, `report`) can run unattended and only the owner declarations (A1–A6, M/S rounds, `lens.json`, ledger classification) remain interactive.
- ✅ plugin: lens [gates] (lens#77) — Expose the gate rules (ledger count difference, missing server-side check, committed credential, untrusted area) as a machine-readable policy file next to `schema/`, so an orchestrator can route an item to human review without parsing prose.

## 2026-11-15 — D111 review (agile commands driven by a Friday PM)
Read of agile@canary 0.317.0 against Friday's flow (`docs/process.md`, `docs/night.md`, D22, D111). Paths relative to the plugin root.
- ⏳ plugin: agile [generic] — No host mode: an external orchestrator cannot turn off agile's board writes, merge and ship and keep only the phases up to `validating`, with state, PR, verdicts and merge owned by the host. Evidence: `skills/autopilot-run/SKILL.md:43`.
- ⏳ plugin: agile [generic] — Merge method is fixed to merge commits; a host requiring squash with an expected head SHA cannot use the ship. Evidence: `references/ship-pr.md:11`.
- ⏳ plugin: agile [generic] — Autonomy policy is read from the project's own `CLAUDE.md`, which an item branch can edit; it needs a source outside the worktree (host registry or the main branch). Evidence: `references/autonomy.md:49-50`.
- ⏳ plugin: agile [generic] — Autonomy is binary (owner or Claude): no named decider per category, no "both", no presets. Evidence: `references/autonomy.md:52-53`.
- ⏳ plugin: agile [bootstrap] — The quiz never writes the autonomy line, priority or cadence, gate rigor, team members or an agent budget. Evidence: `references/autonomy.md:50`.
- ⏳ plugin: agile [generic] — Resolve accepts only issues written by the `gh api user` login, so a project with several humans, or an agent login, cannot resolve its issues. Evidence: `references/resolve-run.md:6`.
- ⏳ plugin: agile [generic] — The review verdict is a Markdown table, not a machine-readable verdict bound to the head SHA. Evidence: `agents/reviewer.md:40-42`.
- ⏳ plugin: agile [generic] — Events are Markdown lines in the item file with no decider identity, so a host cannot measure agreement per human. Evidence: `references/events.md:6`.
- ⏳ plugin: agile [generic] — Repository text is English-only; a host with a hybrid language rule (pt-BR docs and commits) cannot configure it. Evidence: `references/conventions.md:99`.
- ⏳ plugin: agile [generic] — Branch names are fixed to `feature/F-<n>` / `bug/B-<n>`, with no host-provided pattern. Evidence: `references/worktrees.md:27`.
- ⏳ plugin: agile [generic] — Board state goes through Projects GraphQL (`board-flight.js`), with no label-only mode for hosts without GraphQL. Evidence: `references/board.md:42-44`.
- ⏳ plugin: agile [stack: node/typescript] — No profile, skeleton or gate for a Node/TypeScript (pnpm) stack: the skeleton copies .NET templates and the build/test hooks need a .NET project. Evidence: `skills/bootstrap-quiz/SKILL.md:49-51`.
