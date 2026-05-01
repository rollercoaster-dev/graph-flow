---
name: work-on-issue
description: Run a supervised graph-flow issue workflow in Codex with explicit checkpoints between phases. Use when the user wants human approval before research, implementation, review, or PR creation.
---

# graph-flow Work-On-Issue

This is the Codex-native equivalent of the Claude `/work-on-issue` workflow.

## Workflow

1. Run `setup`.
2. Present issue context and wait for approval before research if the user asked for gated execution.
3. Research and create the plan.
4. Present the plan and wait for approval before implementation.
5. Run `implement`.
6. Present implementation and validation status, then wait for approval before `review` and `finalize`.
7. Run the `review` phase unless the user explicitly asked to skip the review phase itself. If the user only asked to skip the approval gate, still run `review` but proceed to `finalize` without a separate approval prompt.
8. Run `finalize`.

## Operating Rules

- Keep all approvals explicit and local to the thread.
- Prefer graph-flow MCP tools when they are available.
- Keep summaries concise at each gate so the user can approve quickly.
- Do not silently continue through a gate that the user asked to supervise.
