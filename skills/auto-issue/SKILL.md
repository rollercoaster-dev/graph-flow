---
name: auto-issue
description: Fully autonomous issue-to-PR workflow. Use when a worker should execute one issue end-to-end without human gates.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill, Task
---

# Auto-Issue Skill

Runs a single issue from setup to PR creation.

## Contract

### Input

| Field          | Type    | Required | Description                                   |
| -------------- | ------- | -------- | --------------------------------------------- |
| `issue_number` | number  | Yes      | GitHub issue number                           |
| `dry_run`      | boolean | No       | Stop after research and output the plan       |
| `skip_review`  | boolean | No       | Skip review phase and continue to finalize    |
| `force_pr`     | boolean | No       | Allow PR creation even with unresolved issues |
| `visual`       | boolean | No       | Force visual workflow (overrides auto-detect)  |
| `no_visual`    | boolean | No       | Suppress visual workflow                       |
| `figma_url`    | string  | No       | Figma URL to pass to visual-test skill         |

### Output

| Field            | Type   | Description                    |
| ---------------- | ------ | ------------------------------ |
| `issue_number`   | number | Processed issue               |
| `branch`         | string | Branch used for implementation |
| `plan_path`      | string | Development plan path          |
| `pr_number`      | number | PR number (if created)         |
| `pr_url`         | string | PR URL (if created)            |
| `status`         | string | `dry_run`, `completed`, `failed` |
| `visual_active`  | boolean | True iff Phase 1.5/1.6 was executed (visual mode resolved to active); false otherwise |

## Workflow

### Phase 1: Setup

Run:

```text
Skill(setup, args: { issue_number: <N> })
```

Capture `branch` and issue metadata from output.

### Phase 1.5 + 1.6: Visual Capture (conditional)

**Determine if visual mode is active:**

1. If `visual=true` and `no_visual=true` → return error (conflicting flags)
2. If `visual=true` → active
3. If `no_visual=true` → inactive
4. Otherwise, auto-detect from frontend signals:
   - **Issue labels**: `frontend`, `ui`, `visual`, `css`, `component`, `layout`, `responsive`, `design`
   - **Issue body keywords**: "screenshot", "figma", "design", "layout", "responsive", "viewport", "UI"
   - **Linked issues**: presence of a "design issue" reference
5. If any signal matches → active, otherwise → inactive

Set `visual_active` in output based on whether visual mode resolved to active.

**If active, run:**

```text
Skill(visual-test, args: { mode: "design", issue_number: <N>, figma_url: <if provided> })
Skill(visual-test, args: { mode: "before", issue_number: <N> })
```

Store screenshot paths in workflow state. Both calls are best-effort — if skipped, continue normally.

### Phase 2: Research

Run issue analysis with the issue-researcher agent using `Task`. The researcher discovers the project's plan conventions (Phase 1.8 in the researcher workflow) and saves the plan at the appropriate location — defaults to `.claude/dev-plans/issue-<N>.md` but uses the project's configured plan directory if one exists (e.g. `docs/exec-plans/`).

Capture `plan_path` from the researcher output — do not assume a hardcoded location.

If `dry_run=true`, return the plan path and stop.

### Phase 3: Implement

Run:

```text
Skill(implement, args: { issue_number: <N>, plan_path: "<path>" })
```

Implementation must be incremental and committed in logical chunks.

### Phase 4: Review

If `skip_review=true`, skip this phase.

Otherwise run:

```text
Skill(review, args: { workflow_id: "issue-<N>" })
```

The review skill includes a `/simplify` pass (Step 1.5) before spawning review agents, improving code quality before the detailed review.

If unresolved critical findings remain and `force_pr` is false, stop with `failed` status.

### Phase 4.5: Visual After (conditional)

**If visual mode was activated in Phase 1.5/1.6:**

```text
Skill(visual-test, args: { mode: "after", issue_number: <N> })
```

Captures final app state and compares with design screenshots. Best-effort — if skipped, continue to finalize.

### Phase 5: Finalize

Run:

```text
Skill(finalize, args: { issue_number: <N>, force: <force_pr> })
```

Return PR details and `completed` status.

## Error Handling

| Condition | Behavior |
| --------- | -------- |
| Setup fails | Stop immediately and return failure |
| Research fails | Stop and report blocker |
| Implement fails | Stop and report failing step |
| Review unresolved criticals + force_pr=false | Stop and escalate |
| Finalize fails | Stop and report push/PR failure |

## Compatibility Notes

- This skill exists to support worker prompts that call `Skill(graph-flow:auto-issue, args: "<issue>")`.
- The canonical workflow definition remains `/auto-issue`.
