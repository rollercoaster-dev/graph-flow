# /auto-merge [pr-number|pr-url]

Autonomous PR merge workflow. Gets a PR to merge-ready state and merges it.

**Mode:** Autonomous - continuous operation until merge or unresolvable blocker.

---

## Usage

```bash
/auto-merge              # Detect PR from current branch
/auto-merge 592          # Merge specific PR by number
/auto-merge #592         # Also accepts # prefix
/auto-merge <url>        # Merge PR by URL
```

---

## Workflow Overview

```text
Step 1: Identify PR     → From arg or current branch
Step 2: Check Checkpoint → Link to existing workflow if present
Step 3: Rebase Check    → Rebase if behind base branch
Step 4: Conflict Check  → Resolve merge conflicts if any
Step 5: CI Check        → Wait if running, fix if failed
Step 6: Review Comments → Validate and fix valid feedback
Step 7: Merge           → Squash merge to base branch
```

---

## Step 1: Identify PR

**From argument:**

```bash
# By number
gh pr view <number> --json number,headRefName,baseRefName,url,state

# By URL - extract number from URL
```

**From current branch:**

```bash
BRANCH=$(git branch --show-current)
gh pr list --head "$BRANCH" --json number,headRefName,baseRefName,url,state --limit 1
```

**Validation:**

- PR must exist
- PR must be in OPEN state
- PR must not be a draft

**On error:** Report and exit.

---

## Step 2: Check Checkpoint

Look for existing workflow checkpoint linked to this PR's issue.

```bash
# Extract issue number from PR (if linked)
gh pr view <number> --json body | jq -r '.body' | grep -oE '#[0-9]+' | head -1
```

**If checkpoint exists:**

- Link this merge operation to the workflow
- Use `checkpoint_workflow_update` to track merge phase

**If no checkpoint:** Continue without (standalone merge).

---

## Step 3: Rebase Check

```bash
# Check if PR is behind base branch
gh pr view <number> --json mergeStateStatus,mergeable

# mergeStateStatus values:
# - BEHIND: needs rebase
# - BLOCKED: checks failing or review required
# - CLEAN: ready to merge
# - DIRTY: merge conflicts
# - UNKNOWN: still computing
```

**If BEHIND:**

```bash
# Checkout PR branch
gh pr checkout <number>

# Rebase on base branch
git fetch origin
git rebase origin/<base-branch>

# Force push (safe for feature branches)
git push --force-with-lease
```

**On rebase conflict:** Go to Step 4 (Conflict Resolution).

**After rebase:** Wait for CI to restart, then continue.

---

## Step 4: Conflict Resolution

**Detect conflicts:**

```bash
# Check mergeable status
gh pr view <number> --json mergeable

# Or during rebase
git rebase origin/<base> 2>&1 | grep -q "CONFLICT"
```

**Resolution strategy:**

1. Analyze conflicting files
2. Understand the intent of both changes
3. Resolve conflicts preserving both intents when possible
4. If unclear, prefer the base branch (safer)

```bash
# After resolution
git add <resolved-files>
git rebase --continue
git push --force-with-lease
```

**On unresolvable conflict:** Report to user with details, exit.

---

## Step 5: CI Check

**Get CI status:**

```bash
gh pr checks <number> --json name,state,conclusion
gh pr view <number> --json statusCheckRollup
```

**Status handling:**

| Status      | Action                              |
| ----------- | ----------------------------------- |
| IN_PROGRESS | Wait 30s, re-check (max 20 retries) |
| SUCCESS     | Continue to Step 6                  |
| FAILURE     | Attempt fix                         |
| PENDING     | Wait 30s, re-check                  |

**Key checks to monitor:**

- CI workflow (Lint, Type Check, Tests, Build)
- CodeQL Security Scanning
- CodeRabbit (status context)

**On CI failure:**

1. Identify failing check
2. Fetch failure details from GitHub Actions
3. Analyze and fix the issue
4. Commit fix: `fix(<scope>): resolve CI failure - <description>`
5. Push and wait for CI restart
6. Repeat until success or max 3 fix attempts

```bash
# Get failure details
gh run view <run-id> --log-failed
```

**On persistent failure (3+ attempts):** Report to user, exit.

---

## Step 6: Review Comments

**Fetch review comments:**

```bash
# Inline review comments
gh api repos/rollercoaster-dev/monorepo/pulls/<number>/comments

# Issue comments (includes CodeRabbit summary)
gh api repos/rollercoaster-dev/monorepo/issues/<number>/comments
```

**Comment classification:**

| Source            | Treatment                                |
| ----------------- | ---------------------------------------- |
| coderabbitai[bot] | Parse for actionable items, fix critical |
| claude[bot]       | Parse for actionable items, fix critical |
| Human reviewer    | All comments are valid, address them     |

**CodeRabbit parsing:**

- `_Potential issue_` or severity indicators → Critical, must fix
- `_Nitpick_` → Optional, skip unless trivial
- Checkmarks → Approval, no action

**For each valid comment:**

1. Understand the feedback
2. Implement the fix
3. Commit: `fix(<scope>): address review - <description>`
4. Reply to comment (if API supports) or note in commit message

**After fixes:** Push and return to Step 5 (CI will re-run).

---

## Step 7: Merge

**Pre-merge validation:**

```bash
# Final status check
gh pr view <number> --json mergeStateStatus,mergeable,reviewDecision

# All must be true:
# - mergeStateStatus: CLEAN
# - mergeable: MERGEABLE
```

**Merge:**

```bash
gh pr merge <number> --squash --delete-branch
```

**CRITICAL: NEVER use `--admin` or `--auto` flags.**

- `--admin` bypasses all protections and can merge broken code
- `--auto` skips review comment validation

If merge is blocked, wait for CI to complete, then check review comments before merging. ASK the user if unclear.

**Post-merge:**

1. Update checkpoint workflow status to "completed" (if exists)
2. Update board status to "Done" (if linked issue)

```bash
# If checkpoint exists
checkpoint_workflow_update({ workflowId, status: "completed" })

# If linked to issue on board
# Use board-manager skill pattern to move to Done
```

---

## Task System Integration

Create tasks for progress visualization:

```text
After PR identified, create all tasks:

  identify = TaskCreate({
    subject: "Identify: PR #<N>",
    description: "Locate and validate PR",
    activeForm: "Identifying PR #<N>",
    metadata: { prNumber: <N>, phase: "identify" }
  })
  TaskUpdate(identify, { status: "completed" })

  rebase = TaskCreate({
    subject: "Rebase: PR #<N>",
    description: "Check and rebase if needed",
    activeForm: "Rebasing PR #<N>",
    metadata: { prNumber: <N>, phase: "rebase" }
  })
  TaskUpdate(rebase, { addBlockedBy: [identify] })

  conflicts = TaskCreate({
    subject: "Conflicts: PR #<N>",
    description: "Resolve any merge conflicts",
    activeForm: "Resolving conflicts in PR #<N>",
    metadata: { prNumber: <N>, phase: "conflicts" }
  })
  TaskUpdate(conflicts, { addBlockedBy: [rebase] })

  ci = TaskCreate({
    subject: "CI: PR #<N>",
    description: "Wait for CI, fix failures",
    activeForm: "Monitoring CI for PR #<N>",
    metadata: { prNumber: <N>, phase: "ci" }
  })
  TaskUpdate(ci, { addBlockedBy: [conflicts] })

  reviews = TaskCreate({
    subject: "Reviews: PR #<N>",
    description: "Address review comments",
    activeForm: "Addressing reviews for PR #<N>",
    metadata: { prNumber: <N>, phase: "reviews" }
  })
  TaskUpdate(reviews, { addBlockedBy: [ci] })

  merge = TaskCreate({
    subject: "Merge: PR #<N>",
    description: "Squash merge to base branch",
    activeForm: "Merging PR #<N>",
    metadata: { prNumber: <N>, phase: "merge" }
  })
  TaskUpdate(merge, { addBlockedBy: [reviews] })
```

---

## Error Handling

| Error                  | Behavior                                |
| ---------------------- | --------------------------------------- |
| PR not found           | Report error, exit                      |
| PR is draft            | Report error, exit                      |
| PR already merged      | Report success (no-op), exit            |
| PR closed              | Report error, exit                      |
| Unresolvable conflict  | Report details, exit                    |
| CI fails 3+ times      | Report details, exit                    |
| Review comment unclear | Skip comment, note in summary           |
| Merge blocked          | Wait for CI, check reviews, then merge  |
| Branch policy error    | Wait for CI to complete, ASK if unclear |

---

## Success Criteria

Workflow succeeds when:

- PR is merged to base branch
- Branch is deleted (automatic)
- Checkpoint updated to "completed" (if exists)
- Board updated to "Done" (if linked issue)

---

## Polling Behavior

For CI and status checks, use exponential backoff:

```text
Attempt 1-5:   30s intervals
Attempt 6-10:  60s intervals
Attempt 11-20: 120s intervals
Max wait:      ~45 minutes total
```

After max attempts, report timeout and exit.

---

## Commands Reference

```bash
# PR info
gh pr view <n> --json number,state,mergeStateStatus,mergeable,statusCheckRollup

# CI status
gh pr checks <n>

# Checkout PR
gh pr checkout <n>

# Rebase
git rebase origin/<base>
git push --force-with-lease

# Review comments
gh api repos/rollercoaster-dev/monorepo/pulls/<n>/comments
gh api repos/rollercoaster-dev/monorepo/issues/<n>/comments

# Merge
gh pr merge <n> --squash --delete-branch
```
