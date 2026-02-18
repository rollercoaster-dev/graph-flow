# Multi-Issue Workflow: Shared Phases

Shared execution phases for `/auto-epic` and `/auto-milestone`. Both commands reference this document for Phases 2-4 and Resume Protocol. Each command defines its own Phase 1 (planning) and argument parsing.

**Placeholders:** `<team-name>` refers to the team created in Phase 1 (e.g., `epic-<N>` or `milestone-<name>`).

---

## Phase 2: Execute

Spawn teammates to work through the task list. Wave gating is automatic — tasks in later waves have `blockedBy` dependencies on earlier wave tasks, so teammates can only claim unblocked tasks.

### Sequential (default, `--parallel 1`)

Spawn 1 teammate. It works through tasks in wave order, one at a time:

```text
Task({
  prompt: "You are a worker on team <team-name>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Execute it by running: Skill(graph-flow:auto-issue, args: '<issue-number>'). When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain. Before each task, run `git checkout main && git pull origin main`.",
  subagent_type: "general-purpose",
  team_name: "<team-name>",
  name: "worker-1",
  mode: "bypassPermissions"
})
```

### Parallel (`--parallel N`)

Spawn N teammates. They self-claim from the shared task list. Each task has a `worktreePath` in its metadata — workers **must** `cd` to that path before executing the skill:

```text
For i in 1..N:
  Task({
    prompt: "You are worker-<i> on team <team-name>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Read the task's metadata for worktreePath. cd to that worktree path FIRST, then execute: Skill(graph-flow:auto-issue, args: '<issue-number>'). The branch is already created in the worktree — the auto-issue skill will detect it. When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain.",
    subagent_type: "general-purpose",
    team_name: "<team-name>",
    name: "worker-<i>",
    mode: "bypassPermissions"
  })
```

### Pre-existing Work Detection

Before spawning teammates, assess the current state of each issue. For each open issue, run:

```bash
# Check for existing PR
gh pr list --search "head:feat/issue-<N>" --state open --json number,url,statusCheckRollup

# Check for existing branch with commits
git fetch origin
git rev-list --count origin/main..origin/feat/issue-<N> 2>/dev/null

# Check for existing worktree
./scripts/worktree-manager.sh path <N> 2>/dev/null
```

Route each issue based on what exists:

| State | Action |
|-------|--------|
| Already closed | Mark task completed, skip |
| Open PR exists (CI green) | Skip to Phase 3 review cycle for this PR |
| Open PR exists (CI failing) | Send worker to fix CI in that branch, then Phase 3 |
| Branch with commits, no PR | Spawn worker with context: "Issue #N has existing work on branch `feat/issue-<N>`. Read the issue requirements and the dev plan (if one exists). Review what's been implemented so far via `git log` and `git diff origin/main`. Complete any remaining work, ensure tests pass, then create a PR. Report PR number when done." |
| No branch | Standard auto-issue execution |

The key difference from a fresh start: when work exists, the worker **checks it against the issue and dev plan** rather than starting from scratch. The auto-issue skill already handles branch detection, but the worker prompt must tell it to assess completeness first.

### Teammate Messages

As teammates complete tasks, they send messages with PR numbers. The lead:

1. Records the PR number for Phase 3
2. Updates checkpoint status
3. Monitors progress via TaskList

### Failure Handling

If a teammate reports failure:

- Log failure with error details
- Mark dependent tasks as blocked (they already are via `blockedBy`, but update metadata with failure info)
- Continue — other teammates keep working on independent tasks
- Report failed issues in summary

---

## Phase 3: Per-PR Review Cycle

**Lead-managed.** As each teammate reports a PR number, the lead runs the review cycle for that PR. This happens per-PR, not batched.

For each PR:

### Step 1: Wait for CI

```bash
gh pr checks <pr-number> --watch
```

If CI fails:

1. Send the teammate a message to fix:

   ```text
   SendMessage({
     type: "message",
     recipient: "worker-<i>",
     content: "CI failed on PR #<N>. Please fix the failures, commit, and push. Send me a message when done.",
     summary: "CI fix request for PR #<N>"
   })
   ```

2. Re-wait for CI (max 2 attempts)
3. If still failing after 2 attempts → mark as failed, notify user

### Step 2: Wait for CodeRabbit

Poll for CodeRabbit review:

```bash
gh api repos/rollercoaster-dev/graph-flow/pulls/<N>/reviews
```

- Wait up to 5 minutes for a review to appear
- If no review appears, proceed anyway (CodeRabbit may be slow or disabled)

### Step 3: Read and Address Review Comments

```bash
gh api repos/rollercoaster-dev/graph-flow/pulls/<N>/comments
```

Claude triages comments:

- **Nitpick / style** → skip (note in Telegram message)
- **Real issue / bug** → send teammate a message to fix:

  ```text
  SendMessage({
    type: "message",
    recipient: "worker-<i>",
    content: "Review comments on PR #<N> need addressing:\n<comments>\nPlease fix, commit, push, and message me when done.",
    summary: "Review fix request for PR #<N>"
  })
  ```

- After fix: re-wait for CI

### Step 4: Telegram Notification (Per-PR)

```text
Skill(telegram, args: "ask: PR #<N> for issue #<M> ready for review.
<title>
<pr-url>
CI: <passed/failed> | CodeRabbit: <X> comments (<Y> addressed)

Reply: merge / changes: <feedback> / skip")
```

### Step 5: Handle Reply

**Guard: Steps 1-3 must have completed before merge.** Even if CI is green and the user says "merge", do NOT merge until CodeRabbit review (Step 2) and comment triage (Step 3) have run. If they haven't, run them now before proceeding.

- **"merge"** / **"lgtm"** / **"ok"** → verify review steps ran, then merge the PR:

  ```bash
  gh pr merge <N> --squash --delete-branch
  ```

  Then update main:

  ```bash
  git checkout main && git pull origin main
  ```

  Then update checkpoint:

  ```text
  checkpoint_update(issue: <M>, status: "merged")
  ```

- **"changes: ..."** → send feedback to the teammate, re-run CI, re-notify via Telegram

- **"skip"** → mark as skipped, continue to next PR

- **No response / timeout** → send reminder after 10 minutes, wait indefinitely (the user controls the pace)

---

## Phase 4: Cleanup

After all waves are processed:

1. **Shut down teammates:**

   ```text
   For each active teammate:
     SendMessage({
       type: "shutdown_request",
       recipient: "worker-<i>",
       content: "All tasks complete, shutting down."
     })
   ```

2. **Clean up worktrees** (if parallel mode was used):

   ```bash
   ./scripts/worktree-manager.sh cleanup-all --force
   git worktree prune
   ```

3. **Delete team:**

   ```text
   TeamDelete()
   ```

4. **Ensure repo on main:**

   ```bash
   git checkout main && git pull origin main
   ```

5. **Generate summary** (format varies by command — see command-specific cleanup steps)

6. **Send notification** via Telegram

7. **Update checkpoint** status to completed or partial

---

## Resume Protocol

On `--continue`, reconstruct state from **both** checkpoint DB and live GitHub state. Checkpoint provides the saved status; GitHub provides the current truth.

### Step 1: Load Checkpoint

```text
Read checkpoint DB for <scope identifier>
→ Returns per-issue records: { issue, wave, status, pr, error }
```

If no checkpoint exists, fall through to normal Phase 1 execution.

### Step 2: Reconcile with GitHub

For each issue in the checkpoint, verify against live state:

```bash
# Is the issue closed?
gh issue view <N> --json state -q '.state'

# Is there an open PR?
gh pr list --search "head:feat/issue-<N>" --state all --json number,state,mergeCommit

# Is there a branch with commits?
git fetch origin
git rev-list --count origin/main..origin/feat/issue-<N> 2>/dev/null

# Is there an existing worktree?
./scripts/worktree-manager.sh path <N> 2>/dev/null
```

### Step 3: Route Each Issue

| Checkpoint Status | GitHub State | Action |
|-------------------|-------------|--------|
| merged | Issue closed | Skip |
| review | PR merged | Update checkpoint to merged, skip |
| review | PR open, CI green | Resume at Phase 3 (review cycle) |
| review | PR open, CI failing | Send worker to fix, then Phase 3 |
| running/failed | PR exists | Resume at Phase 3 |
| running/failed | Branch with commits, no PR | Run pre-existing work detection (see Phase 2) |
| running/failed | No branch | Re-execute from Phase 2 |
| pending | Any | Run pre-existing work detection, then Phase 2 |

### Step 4: Rebuild Team + Tasks

1. Check if team exists (read `~/.claude/teams/<team-name>/config.json`)
2. If team exists → resume with existing team, reconcile TaskList with checkpoint
3. If no team → create fresh team, create tasks only for non-skipped issues
4. Display reconciled plan showing what was completed vs. what remains

---

## State Management

State tracked in three systems:

1. **Checkpoint DB** (`.claude/execution-state.db`) — source of truth for workflow status, actions, PR numbers
2. **Native tasks** — UI-only progress visualization with wave-based `blockedBy` dependencies
3. **Team task list** — coordination state for teammate self-claiming
