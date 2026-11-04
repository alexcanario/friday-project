# Retro log

Lessons for the sibling plugins, in the format their own sessions take in (agile@canary `references/retro-log-entry.md`; lens: a session in its repository captures each note with `/agile:idea`). Friday sessions only append here; they never write in the agile-canary or legacy-lens repositories. Each plugin's session reads its ⏳ rows, opens the item on its own board, and lists it as delivered; the row is then marked ✅ here by a friday-project session. Notes are in English (messages between sessions).

## Plugin notes — status
| Status | Plugin | Note | From | Plugin version |
|---|---|---|---|---|
| ✅ Control-Alt-Sistems/lens#76 (F-47) | lens | No characterization/golden-master tooling: changes to untrusted legacy areas have only a written-note fallback | 2026-11-04 method-packs review | 0.18.0 |
| ✅ already delivered, Control-Alt-Sistems/lens#48 (F-31) | lens | No headless mode for the non-interactive part of adoption (map, guard candidates, report) | 2026-11-04 method-packs review | 0.18.0 |
| ✅ Control-Alt-Sistems/lens#77 (F-48) | lens | No machine-readable risk and gate policy an orchestrator can apply | 2026-11-04 method-packs review | 0.18.0 |

## To check

## 2026-11-04 — method-packs review (docs/method-packs.md, D22)
- ✅ plugin: lens [characterization] (lens#76) — An orchestrator hosting lens needs a deterministic way to lock current behaviour before a change: a characterization or golden-master step (inputs → recorded outputs, compared after the change), callable headless. Today `adoption-questions.md` A5 only allows "a characterization test or a written note".
- ✅ plugin: lens [headless] (delivered by lens#48; its headless mode does not run `candidates`, by decision of F-31, and no item was opened for that) — `/lens:adopt` must run interactively. Split it so the deterministic steps (`lens-dotnet map`, `guard`, `candidates`, `link`, `report`) can run unattended and only the owner declarations (A1–A6, M/S rounds, `lens.json`, ledger classification) remain interactive.
- ✅ plugin: lens [gates] (lens#77) — Expose the gate rules (ledger count difference, missing server-side check, committed credential, untrusted area) as a machine-readable policy file next to `schema/`, so an orchestrator can route an item to human review without parsing prose.
