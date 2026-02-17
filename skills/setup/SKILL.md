---
name: setup
description: Prepares environment for issue work - creates branch, adds to board, fetches issue details. Use at the start of any issue workflow.
allowed-tools: Bash, Read, Skill
---

# Setup Skill

Prepares everything needed before implementation work begins.

## Contract

### Input

| Field          | Type    | Required | Description                                         |
| -------------- | ------- | -------- | --------------------------------------------------- |
| `issue_number` | number  | Yes      | GitHub issue number                                 |
| `branch_name`  | string  | No       | Custom branch name (auto-generated if not provided) |
| `skip_board`   | boolean | No       | Skip board operations (default: false)              |
| `skip_notify`  | boolean | No       | Skip Telegram notification (default: false)         |

### Output

| Field          | Type     | Description     |
| -------------- | -------- | --------------- |
| `branch`       | string   | Git branch name |
| `issue.number` | number   | Issue number    |
| `issue.title`  | string   | Issue title     |
| `issue.body`   | string   | Full issue body |
| `issue.labels` | string[] | Issue labels    |

### Side Effects

1. Creates git branch (or checks out existing)
2. Adds issue to project board as "In Progress" (unless skip_board)
3. Sends Telegram notification (unless skip_notify)

## Prerequisites

Requires graph-flow MCP tools. If unavailable, run `/graph-flow:init` first, then restart Claude Code.

## Workflow

### Step 1: Fetch Issue

```bash
gh issue view <issue_number> --json number,title,body,labels,milestone,assignees
```

If issue not found: STOP, return error.

Extract and store:

- `issue.number`
- `issue.title`
- `issue.body`
- `issue.labels` (array of label names)

### Step 2: Generate Branch Name

If `branch_name` not provided:

- Extract short description from issue title (lowercase, hyphenated, max 30 chars)
- Format: `feat/issue-<number>-<short-description>`

Example: Issue "Add user authentication" → `feat/issue-123-add-user-auth`

### Step 3: Create Branch

Check current branch:

```bash
git branch --show-current
```

If not on target branch:

```bash
git checkout -b <branch_name>
```

If branch already exists:

```bash
git checkout <branch_name>
```

### Step 4: Update Board (unless skip_board)

Use the `a-board-update` MCP tool:

```
a-board-update({ issueNumber: <issue_number>, status: "In Progress" })
```

**If board update fails:** Log warning, continue (non-critical).

### Step 5: Send Notification (unless skip_notify)

Use the `telegram` skill (via Skill tool) to send a notification:

```text
Started: Issue #<number>
Title: <title>
Branch: <branch>
```

**If notification fails:** Log warning, continue (non-critical).

### Step 6: Return Output

Return structured output:

```json
{
  "branch": "<branch_name>",
  "issue": {
    "number": <number>,
    "title": "<title>",
    "body": "<body>",
    "labels": ["<label1>", "<label2>"]
  }
}
```

## Error Handling

| Condition             | Behavior                      |
| --------------------- | ----------------------------- |
| Issue not found       | Return error, no side effects |
| Branch checkout fails | Return error with git status  |
| Board update fails    | Warn, continue                |
| Notification fails    | Warn, continue                |

## Example

**Input:**

```json
{
  "issue_number": 487
}
```

**Output:**

```json
{
  "branch": "feat/issue-487-agent-architecture",
  "issue": {
    "number": 487,
    "title": "refactor(claude-tools): implement robust agent architecture",
    "body": "## Problem\n\nThe current Claude tools architecture...",
    "labels": ["enhancement", "priority:high"]
  }
}
```

## Output Format

After completing all steps, report:

```text
SETUP COMPLETE

Issue: #<number> - <title>
Branch: <branch>
Board: Updated to "In Progress"

Ready for next phase.
```
