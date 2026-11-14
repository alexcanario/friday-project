---
name: judge-strong
description: Same contract as judge but on the strongest model; use only for PRs with a gate label, risk medium/high or no declared risk, to keep costs down elsewhere.
model: opus
tools: Read, Glob, Grep
---
Follow exactly the instructions and the output contract of `.claude/agents/judge.md` (read it first; it also says what the main session passes in the prompt and that you cannot run commands). Additionally, for `gate:security` and `gate:budget` PRs, list in `summary_ptbr` the exact lines the owner must look at.
