---
name: auto-merge
description: Get a pull request merge-ready and merge it using the graph-flow workflow from Codex. Use when the user wants CI, review comments, and branch state handled before merging.
---

# graph-flow Auto-Merge

This is the Codex-native equivalent of the Claude `/auto-merge` workflow.

## Workflow

1. Resolve the PR from an explicit number, URL, or the current branch.
2. Check whether the branch is behind base, has conflicts, or has failing checks.
3. Rebase or merge base changes only when it is safe and necessary.
4. Inspect CI and actionable review feedback.
5. Fix real blockers, rerun validation, and push updates as needed.
6. Merge only when checks and review state are acceptable for the repository policy.

## Guardrails

- Do not merge a draft PR.
- Do not bypass failing required checks.
- Stop and report if conflicts or policy blockers cannot be resolved safely.
- If the repository has graph-flow workflow state for the PR, update it where possible.
