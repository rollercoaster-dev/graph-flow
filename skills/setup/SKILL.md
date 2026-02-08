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

## Skills Used

Load these skills for reference:

- `board-manager` - GraphQL for board operations

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

**4a. Get issue node ID:**

```bash
gh issue view <issue_number> --json id -q .id
```

**4b. Add to project board:**

```bash
gh api graphql -f query='
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: {
      projectId: $projectId
      contentId: $contentId
    }) { item { id } }
  }' -f projectId="PVT_kwDOB1lz3c4BI2yZ" -f contentId="<issue_node_id>"
```

**4c. Get item ID:**

```bash
gh api graphql -f query='
  query {
    organization(login: "rollercoaster-dev") {
      projectV2(number: 11) {
        items(first: 100) {
          nodes {
            id
            content { ... on Issue { number } }
          }
        }
      }
    }
  }' | jq -r '.data.organization.projectV2.items.nodes[] | select(.content.number == <issue_number>) | .id'
```

**4d. Set status to "In Progress":**

```bash
gh api graphql \
  -f projectId="PVT_kwDOB1lz3c4BI2yZ" \
  -f itemId="<item_id>" \
  -f fieldId="PVTSSF_lADOB1lz3c4BI2yZzg5MUx4" \
  -f optionId="3e320f16" \
  -f query='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }'
```

**If any board operation fails:** Log warning, continue (non-critical).

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
