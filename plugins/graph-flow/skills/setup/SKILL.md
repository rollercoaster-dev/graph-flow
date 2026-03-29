---
name: setup
description: Prepare an issue workflow in Codex by fetching issue context, creating or switching to the feature branch, and updating graph-flow state where available. Use at the start of issue execution.
---

# graph-flow Setup

Prepare issue work before implementation starts.

## Workflow

1. Resolve the GitHub issue number and fetch issue details with `gh issue view`.
2. Create or switch to a feature branch named `feat/issue-<number>-<slug>` unless the user provided a branch.
3. If graph-flow MCP tools are available, update workflow and board state using the existing checkpoint/planning/automation tools.
4. If MCP is unavailable, continue with git and GitHub setup, but say which graph-flow state updates were skipped.
5. Return a short structured summary with:
   - issue number and title
   - branch name
   - whether board/checkpoint state was updated

## Guardrails

- Do not begin implementation in this skill.
- Stop on git or GitHub lookup failures.
- Keep the branch scoped to the issue.
