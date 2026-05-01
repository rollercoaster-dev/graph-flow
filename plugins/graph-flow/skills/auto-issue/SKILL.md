---
name: auto-issue
description: Run a graph-flow issue from setup through PR creation without intermediate approval gates. Use when the user wants an autonomous issue-to-PR workflow in Codex.
---

# graph-flow Auto-Issue

This is the Codex-native equivalent of the Claude `/auto-issue` workflow.

## Workflow

1. Run the `setup` skill for the issue.
2. Research the issue, discover or create the development plan, and stop early if the user requested a dry run.
3. Run the `implement` skill from that plan.
4. Run the `review` skill unless the user explicitly asked to skip it.
5. Run the `finalize` skill to open the PR.

## Operating Rules

- Prefer graph-flow MCP tools for checkpoint, planning, and board updates.
- Fall back to the graph-flow CLI or direct git/GitHub steps if MCP is unavailable.
- Keep the workflow on a feature branch, never on `main`.
- If unresolved blocking review findings remain, stop unless the user explicitly asked for a force-PR path.

## End State

Return the branch, plan artifact, validation summary, and PR details when created.
