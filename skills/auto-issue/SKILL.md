---
name: auto-issue
description: "Use when the user wants to create a GitHub issue, file a bug, or add a task. Optionally links the new issue to an existing plan."
---

# Auto-Issue

Create a GitHub issue and optionally link it as a step in an existing plan.

## Workflow

1. **Gather details** — Ask the user for:
   - Title (required)
   - Body/description (optional)
   - Labels (optional)
   - Milestone number (optional)
   - Plan ID to link to (optional — check `planning-stack` for active plans)
2. **Call the tool** — Use `automation-create-issue` with the gathered details.
3. **Report results** — Show: issue number, URL, and step ID if linked.
4. **Suggest next steps:**
   - "Use `/work-on-issue` to start working on it immediately"
   - "The issue is now tracked in your plan" (if linked)
