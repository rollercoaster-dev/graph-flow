---
name: auto-milestone
description: "Use when the user wants to import a GitHub milestone into the planning stack, plan a milestone, or organize milestone issues into a structured plan."
---

# Auto-Milestone

Import a GitHub milestone and its issues into the graph-flow planning stack as a Goal + Plan + Steps.

## Workflow

1. **Get milestone number** — Ask the user which milestone to import if not already provided.
2. **Call the tool** — Use `automation-from-milestone` with the milestone number.
3. **Report results** — Show: goal ID, plan ID, number of issues imported, and a summary.
4. **Suggest next steps:**
   - "Use `planning-progress` to check progress at any time"
   - "Use `/work-on-issue` to start working on a specific issue"
   - "Use `planning-steps` to adjust dependencies or wave groupings"
