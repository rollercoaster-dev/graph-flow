---
name: work-on-issue
description: "Use when the user wants to start working on a GitHub issue. Creates a branch, pushes a goal onto the planning stack, and creates a workflow checkpoint."
---

# Work on Issue

Start working on a GitHub issue with full tracking: branch, planning goal, and workflow checkpoint.

## Workflow

1. **Get issue number** — Ask the user which issue to work on if not already provided.
2. **Call the tool** — Use `a-start-issue` with the issue number.
3. **Report results** — Show:
   - Branch name (already checked out)
   - Goal ID (pushed to planning stack)
   - Checkpoint ID (workflow tracking active)
   - Issue title and summary
   - Whether it's linked to an existing plan step
4. **Summarize the issue** — Present the issue body so the user has full context.
5. **Suggest first step** — Based on the issue content, suggest where to start.
