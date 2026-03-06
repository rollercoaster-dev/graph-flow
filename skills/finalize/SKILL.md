---
name: finalize
description: Completes issue workflow - pushes branch, creates PR, updates board, marks workflow complete. Use at the end of any issue workflow.
allowed-tools: Bash, Read, Skill
---

# Finalize Skill

Completes the workflow by creating PR and cleaning up.

## Contract

### Input

| Field              | Type    | Required | Description                                            |
| ------------------ | ------- | -------- | ------------------------------------------------------ |
| `issue_number`     | number  | Yes      | GitHub issue number                                    |
| `findings_summary` | object  | No       | Summary from review phase                              |
| `force`            | boolean | No       | Create PR even with unresolved issues (default: false) |
| `skip_board`       | boolean | No       | Skip board update (default: false)                     |
| `skip_notify`      | boolean | No       | Skip Telegram notification (default: false)            |

### Output

| Field             | Type   | Description                            |
| ----------------- | ------ | -------------------------------------- |
| `pr.number`       | number | PR number                              |
| `pr.url`          | string | PR URL                                 |
| `pr.title`        | string | PR title                               |
| `board_status`    | string | Final board status                     |
| `workflow_status` | string | "completed" or "completed_with_issues" |

### Side Effects

1. Pushes branch to remote
2. Creates GitHub PR
3. Updates board to "Blocked" (awaiting review)
4. Cleans up the issue's discovered development plan file, if present
5. Sends Telegram notification with PR link

## Prerequisites

Requires graph-flow MCP tools. If unavailable, run `/graph-flow:init` first, then restart Claude Code.

## Workflow

### Step 1: Gather Context

**Get issue title for PR:**

```bash
gh issue view <issue_number> --json title -q .title
```

**Get commit history:**

```bash
git log main..HEAD --oneline
```

**Get diff stats:**

```bash
git diff main --stat
```

**Get branch name:**

```bash
git branch --show-current
```

### Step 2: Run Final Validation

Run validation commands (each separately):

```bash
bun run type-check
```

```bash
bun run lint
```

```bash
bun test
```

```bash
bun run build
```

**If any validation fails and `force` is false:** Return error with failure details.

**If validation fails but `force` is true:** Note in PR body, continue.

### Step 2.5: Commit Visual Evidence (if present)

Check if visual screenshots exist:

```bash
ls .claude/screenshots/issue-<issue_number>/ 2>/dev/null
```

If the directory has files:

```bash
git add .claude/screenshots/issue-<issue_number>/
if ! git diff --cached --quiet; then
  git commit -m "docs: add visual evidence for #<issue_number>"
fi
```

The `git diff --cached --quiet` guard prevents a commit failure if no files were actually staged (e.g., all files are `.gitignore`d or unchanged). This creates a separate commit for screenshot artifacts, keeping them distinct from implementation commits.

### Step 3: Push Branch

```bash
git push -u origin HEAD
```

**If push fails:** Return error (critical).

### Step 4: Create PR

Determine PR type from branch name or commits:

- `feat/` → "feat"
- `fix/` → "fix"
- `refactor/` → "refactor"
- etc.

Determine scope from primary package affected.

**Create PR:**

```bash
gh pr create --title "<type>(<scope>): <description> (#<issue_number>)" --body "$(cat <<'PRBODY'
## Summary

<1-3 bullet points from issue/commits>

## Changes

<bullet list of key changes>

## Test Plan

- [ ] Type-check passes
- [ ] Lint passes
- [ ] Tests pass
- [ ] Build succeeds

<any unresolved findings if force=true>

<if .claude/screenshots/issue-<N>/ has files, build visual evidence section dynamically:>

## Visual Evidence

<Discover files in .claude/screenshots/issue-<N>/ and build sections from what exists:>

<For each design-*.png found, sorted by name:>
### Design Reference
![<filename>](.claude/screenshots/issue-<N>/<filename>)

<For each before-*.png found, sorted by viewport width:>
### Before
![before-<width>](.claude/screenshots/issue-<N>/before-<width>.png)

<For each after-*.png found, sorted by viewport width:>
### After
![after-<width>](.claude/screenshots/issue-<N>/after-<width>.png)

<If comparison.md exists, inline its contents:>
### Design Comparison
<contents of .claude/screenshots/issue-<N>/comparison.md>

<Only include sections where matching files were found. Skip sections with no files to avoid broken image links.>

<end of visual evidence section>

---

Closes #<issue_number>

Generated with [Claude Code](https://claude.ai/code)
PRBODY
)"
```

Extract PR number and URL from output.

### Step 5: Update Board (unless skip_board)

Use the `a-board-update` MCP tool:

```text
a-board-update({ issueNumber: <issue_number>, status: "Blocked" })
```

**If board update fails:** Log warning, continue.

### Step 6: Send Notification (unless skip_notify)

Use the `telegram` skill (via Skill tool) to send a notification:

```
PR Created: #<pr_number>
Issue: #<issue_number> - <title>
URL: <pr_url>
Commits: <count>
Status: Awaiting review
```

**If notification fails:** Log warning, continue.

### Step 7: Return Output

```json
{
  "pr": {
    "number": <pr_number>,
    "url": "<pr_url>",
    "title": "<pr_title>"
  },
  "board_status": "Blocked",
  "workflow_status": "completed"
}
```

## Error Handling

| Condition                      | Behavior                  |
| ------------------------------ | ------------------------- |
| Validation fails (force=false) | Return error with details |
| Push fails                     | Return error (critical)   |
| PR creation fails              | Return error (critical)   |
| Board update fails             | Warn, continue            |
| Notification fails             | Warn, continue            |

## Example

**Input:**

```json
{
  "issue_number": 487,
  "workflow_id": "workflow-487-1736500000000-abc123"
}
```

**Output:**

```json
{
  "pr": {
    "number": 488,
    "url": "https://github.com/rollercoaster-dev/monorepo/pull/488",
    "title": "refactor(claude-tools): implement robust agent architecture (#487)"
  },
  "board_status": "Blocked",
  "workflow_status": "completed"
}
```

## Output Format

After completing all steps, report:

```
FINALIZE COMPLETE

PR: #<pr_number>
URL: <pr_url>
Title: <pr_title>

Board: Updated to "Blocked" (awaiting review)
Workflow: Marked as completed

Commits: <count>

Next: PR will be reviewed by CodeRabbit and team.
```
