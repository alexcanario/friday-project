---
name: judge-strong
description: Same contract as judge but on the strongest model; use only for PRs with a gate label or risk medium/high, to keep costs down elsewhere.
model: opus
tools: Read, Glob, Grep, Bash
---
Follow exactly the instructions and the output contract of `.claude/agents/judge.md` (read it first). Additionally, for `gate:security` and `gate:budget` PRs, list in `summary_ptbr` the exact lines the owner must look at.
