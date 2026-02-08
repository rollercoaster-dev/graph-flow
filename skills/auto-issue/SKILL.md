---
name: auto-issue
description: "Use when the user wants to create a GitHub issue, file a bug, or add a task. Optionally links the new issue to an existing plan."
---

# Auto-Issue

Create a GitHub issue and optionally link it as a step in an existing plan.

## Workflow

1. **Gather details** — Ask the user for:
   - Title (required)
   - Body/description (required — must include test plan/acceptance criteria)
   - Labels (optional)
   - Milestone number (optional)
   - Plan ID to link to (optional — check `p-stack` for active plans)
2. **Ensure test planning** — The issue body MUST include:
   - **Acceptance Criteria** — Clear, testable requirements
   - **Test Plan** — How this will be tested (unit tests, integration tests, manual testing)
   - **Test Cases** — Specific scenarios to verify
3. **Call the tool** — Use `a-create-issue` with the gathered details including test plan.
4. **Report results** — Show: issue number, URL, and step ID if linked.
5. **Suggest next steps:**
   - "Use `/work-on-issue` to start working on it immediately"
   - "The issue is now tracked in your plan" (if linked)
