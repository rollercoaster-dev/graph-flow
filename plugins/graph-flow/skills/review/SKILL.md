---
name: review
description: Run a graph-flow pre-PR review pass in Codex. Use when the user wants bugs, regressions, missing tests, and merge risks identified before a PR is finalized.
---

# graph-flow Review

Perform the graph-flow review phase using Codex-native review behavior.

## Workflow

1. Review the current branch diff against the intended base branch.
2. Prioritize correctness, regressions, missing tests, unsafe assumptions, and release risk.
3. Run targeted validation commands for changed areas.
4. If the user explicitly asks for parallel or delegated review and repo-scoped custom agents exist, use them; otherwise stay single-agent.
5. Group findings by severity and identify what must be fixed before finalize.
6. If no material findings exist, say so explicitly.

## Output

- Findings first, ordered by severity.
- Then residual risks or testing gaps.
- Then a short summary of overall readiness.

## Guardrails

- This skill reviews and fixes only when the user wants fixes as part of the same task.
- Do not merge the PR here.
