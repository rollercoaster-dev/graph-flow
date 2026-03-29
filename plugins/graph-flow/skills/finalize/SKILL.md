---
name: finalize
description: Finalize a graph-flow issue workflow in Codex by preparing the PR, pushing the branch, and updating graph-flow state. Use after implementation and review are complete.
---

# graph-flow Finalize

Turn completed work into a reviewable pull request.

## Workflow

1. Confirm implementation and review are complete enough to open a PR.
2. Push the current branch if needed.
3. Open or update the PR with a clear summary tied to the issue.
4. If graph-flow automation or checkpoint tools are available, update board and workflow state.
5. Return:
   - branch
   - PR number and URL
   - any remaining manual follow-up

## Guardrails

- Do not merge the PR in this skill.
- If blocking review findings remain, stop unless the user explicitly wants a forced PR path.
