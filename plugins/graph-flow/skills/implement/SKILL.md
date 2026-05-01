---
name: implement
description: Execute a graph-flow implementation phase in Codex from an approved issue or plan. Use when code changes should be made from an existing development plan or clearly defined issue scope.
---

# graph-flow Implement

Carry a planned issue through code changes and local validation.

## Workflow

1. Read the issue and the development plan if a `plan_path` or equivalent artifact is available.
2. Confirm the active branch matches the issue workflow.
3. Implement changes in small, logical slices.
4. Run the narrowest meaningful validation after each slice.
5. Create intentional commits instead of one large final dump when the user asked for implementation progress.
6. If graph-flow planning or checkpoint tools are available, keep progress state current.
7. Finish with:
   - what changed
   - validation performed
   - remaining review risks or follow-ups

## Guardrails

- Do not open or merge a PR in this skill.
- Do not skip reading the plan when one exists.
- Keep changes aligned to the requested issue scope.
