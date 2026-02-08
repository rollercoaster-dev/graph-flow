# /auto-milestone $ARGUMENTS

Claude-as-orchestrator for milestone execution. No intermediate scripts -- Claude launches `claude -p` workers directly, manages PRs via `gh`, and runs per-PR Telegram approval cycles.

**Mode:** Autonomous with planning gate — only stops if dependencies are unclear.

**Architecture:** Claude IS the orchestrator. Workers are separate `claude -p` processes (Opus 4.5). Planning uses a separate `claude -p` with the milestone-planner agent protocol (Sonnet).

**Recommended:** Run in tmux for remote observability:

```bash
tmux new -s milestone
claude
/auto-milestone "OB3 Phase 1"
```

---

## CRITICAL: Branch Isolation is Non-Negotiable

**YOU MUST NEVER commit directly to `main` during this workflow.**

Each issue gets its own branch, PR, CI, CodeRabbit review, and Telegram approval before merge. This preserves review quality, rollback safety (close PR vs. revert), dependency tracking, and user control.

```text
Issue #123 → feat/issue-123-... branch → PR #456 → CI → CodeRabbit → Telegram approval → Merge
NEVER: Issue #123 → commit directly to main
```

---

## CRITICAL: No Nested Agents

**YOU MUST NOT use the Task tool to spawn sub-agents.** Context explosion from nested agents causes OOM failures.

All worker processes run as **separate `claude -p` processes** via Bash:

```bash
claude -p "/auto-issue <N>" --max-budget-usd 5 --model opus \
  --output-format text --dangerously-skip-permissions \
  > .claude/output/issue-<N>.log 2>&1
```

The only exception is calling the `telegram` skill via the Skill tool (lightweight, no agent context).

---

## Quick Reference

```bash
/auto-milestone "OB3 Phase 1"              # All issues in milestone (sequential)
/auto-milestone 153 154 155                # Specific issues (space-separated)
/auto-milestone 153,154,155                # Specific issues (comma-separated)
/auto-milestone "Badge Generator" --dry-run # Analyze only, show plan
/auto-milestone "OB3 Phase 1" --parallel 3  # Run 3 issues concurrently
/auto-milestone "OB3 Phase 1" --wave 1      # Only run first wave
```

## Configuration

| Setting      | Default | Description                  |
| ------------ | ------- | ---------------------------- |
| `--parallel` | 1       | Max concurrent issue workers |
| `--dry-run`  | false   | Analyze and plan only        |
| `--wave`     | all     | Only run specific wave       |
| `--skip-ci`  | false   | Skip waiting for CI          |

---

## Task System Integration

Native task tracking provides wave-based progress visualization. Tasks are supplementary to the checkpoint system (source of truth).

### Wave-Based Task Creation

Create ALL tasks upfront during Phase 1, after dependency analysis:

```text
For each wave W (1..N):
  For each issue in wave W:
    taskId = TaskCreate({
      subject: "Issue #<N>: <title>",
      description: "<issue-summary>",
      activeForm: "Working on issue #<N>",
      metadata: { issueNumber, workflowId, waveNumber: W, milestoneId }
    })
    if W > 1:
      TaskUpdate(taskId, { addBlockedBy: previousWaveTasks })
    waveWTasks.push(taskId)

TaskList() → Show full milestone tree immediately
```

### Task Updates During Execution

```text
Phase 2: Execute (as each issue progresses):

On worker launch for issue:
  TaskUpdate(taskId, { status: "in_progress" })

On worker complete (PR created):
  TaskUpdate(taskId, { status: "completed" })

On worker failure:
  TaskUpdate(taskId, { status: "completed", metadata: { failed: true, error } })

After each wave completes:
  TaskList() → Show wave progress, next wave unblocked
```

---

## Workflow

```text
Phase 1: Plan    → claude -p milestone-planner → GATE (if dependencies unclear)
Phase 2: Execute → per-wave: launch claude -p /auto-issue N (Opus 4.5)
Phase 3: Review  → per-PR: CI → CodeRabbit → fix → Telegram approval → merge
Phase 4: Cleanup → remove worktrees, summary, notification
```

---

## Argument Parsing

Detect input type from `$ARGUMENTS`:

| Pattern                              | Mode        | Example                        |
| ------------------------------------ | ----------- | ------------------------------ |
| Numbers only (space/comma separated) | `issues`    | `153 154 155` or `153,154,155` |
| Quoted string or text                | `milestone` | `"OB3 Phase 1"`                |

**Flags** (parsed from any position after the first argument):

- `--parallel N` — concurrent workers per wave
- `--dry-run` — plan only
- `--wave N` — run specific wave only
- `--skip-ci` — skip CI wait

**Validation:**

- Empty arguments → Error: "Usage: /auto-milestone <milestone-name> or <issue-numbers>"
- Mix of numbers and text → Error: "Cannot mix issue numbers and milestone name"
- Invalid issue number → Error: "Issue #X not found"

---

## Phase 1: Plan

### Wave Computation

Launch the milestone-planner as a **separate `claude -p` process** (not a nested agent):

```bash
claude -p "Analyze milestone '<name>' and return execution_waves JSON. \
  Follow the milestone-planner agent protocol. \
  Mode: <milestone|issues>, target: <name-or-numbers>." \
  --model sonnet --output-format json --dangerously-skip-permissions \
  > .claude/output/milestone-plan.json 2> .claude/output/milestone-plan.err
```

Read the output file. The planner returns:

- `execution_waves[]` — ordered list of wave objects `{wave: N, issues: [...]}`
- `dependency_graph` — per-issue dependency map
- `free_issues[]` — issues with no blockers
- `planning_status` — `"ready"` or `"needs_review"`

### Planning Gate

**If `planning_status == "needs_review"`:**

Notify user via Telegram with the plan:

```text
Skill(telegram, args: "ask: MILESTONE PLAN REVIEW
Milestone: <name>
Planning issues detected:
<bullet list of issues>

Proposed dependencies:
<dependency list>

Reply 'approve' to continue or provide feedback.")
```

Wait for response:

- `"approve"` / `"proceed"` / `"ok"` → continue
- `"abort"` → exit
- Other text → treat as feedback, re-plan with context

**If `planning_status == "ready"`:** proceed directly to Phase 2.

### Checkpoint + Task Creation

After wave plan is confirmed:

1. Create milestone in checkpoint DB:

   ```text
   checkpoint_workflow_create for each issue
   ```

2. Create native tasks for wave visualization (see Task System Integration above)

3. Display wave plan:

   ```text
   Milestone "<name>" — N issues in M waves

   Wave 1 (no blockers):
     #153 - Add KeyPair type
     #154 - Implement generator

   Wave 2 (after Wave 1):
     #155 - Add storage service → blocked by #153
   ```

**If `--dry-run`:** Stop here, display plan, exit.

---

## Phase 2: Execute

For each wave in order:

### Wave Gating

Before starting a wave, check that all blocking issues from previous waves have completed successfully. Skip issues whose blockers failed.

### Worker Launch

**Sequential** (default, `--parallel 1`):

For each issue in the wave:

1. Ensure repo is on main with latest:

   ```bash
   git checkout main && git pull origin main
   ```

2. Launch worker:

   ```bash
   claude -p "/auto-issue <N>" --max-budget-usd 5 --model opus \
     --output-format text --dangerously-skip-permissions \
     > .claude/output/issue-<N>.log 2>&1
   ```

3. After worker completes, detect PR:

   ```bash
   gh pr list --search "head:feat/issue-<N>" --state open --json number,headRefName --limit 1
   ```

4. Update checkpoint and task status.

**Parallel** (`--parallel N`):

Launch up to N workers as background processes:

```bash
claude -p "/auto-issue <N>" --max-budget-usd 5 --model opus \
  --output-format text --dangerously-skip-permissions \
  > .claude/output/issue-<N>.log 2>&1 &
```

Wait for all to complete. Then detect PRs for each.

### Pre-existing Work Detection

Before launching a worker, check:

1. **Existing PR:** `gh pr list --search "head:feat/issue-<N>"` → skip issue
2. **Existing branch with commits:** `git rev-list --count origin/main..origin/feat/issue-<N>` → create PR only
3. **Existing worktree:** check `.worktrees/` directory

### Failure Handling

If a worker fails:

- Log failure details
- Mark dependent issues as skipped
- Continue with remaining independent issues in current wave

---

## Phase 3: Per-PR Review Cycle

Each PR goes through an individual review+approval cycle (not batched).

For each PR created in the wave:

### Step 1: Wait for CI

```bash
"$CLAUDE_PROJECT_DIR/scripts/worktree-manager.sh" ci-status <pr-number> --wait
```

If CI fails:

1. Spawn a fix worker:
   ```bash
   claude -p "Fix CI failures for PR #<N>. Run failing checks, fix issues, commit and push." \
     --max-budget-usd 2 --model opus --output-format text --dangerously-skip-permissions \
     > .claude/output/ci-fix-<N>.log 2>&1
   ```
2. Re-wait for CI (max 2 attempts)
3. If still failing after 2 attempts → mark as failed, notify user

### Step 2: Wait for CodeRabbit

Poll for CodeRabbit review:

```bash
gh api repos/rollercoaster-dev/monorepo/pulls/<N>/reviews
```

- Wait up to 5 minutes for a review to appear
- If no review appears, proceed anyway (CodeRabbit may be slow or disabled)

### Step 3: Read and Address Review Comments

```bash
gh api repos/rollercoaster-dev/monorepo/pulls/<N>/comments
```

Claude triages comments:

- **Nitpick / style** → skip (note in Telegram message)
- **Real issue / bug** → spawn fix worker:
  ```bash
  claude -p "Address review comments on PR #<N>: <comments>. Fix issues, commit and push." \
    --max-budget-usd 3 --model opus --output-format text --dangerously-skip-permissions \
    > .claude/output/review-fix-<N>.log 2>&1
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

- **"merge"** / **"lgtm"** / **"ok"** → merge the PR:

  ```bash
  gh pr merge <N> --squash --delete-branch
  ```

  Then update main:

  ```bash
  git checkout main && git pull origin main
  ```

- **"changes: ..."** → spawn fix worker with the feedback, re-run CI, re-notify via Telegram

- **"skip"** → mark as skipped, continue to next PR

- **No response / timeout** → send reminder after 10 minutes, wait indefinitely (the user controls the pace)

---

## Phase 4: Cleanup

After all waves are processed:

1. **Remove worktrees** (if parallel mode used them):

   ```bash
   "$CLAUDE_PROJECT_DIR/scripts/worktree-manager.sh" cleanup-all --force
   ```

2. **Ensure repo on main:**

   ```bash
   git checkout main && git pull origin main
   ```

3. **Generate summary:**

   ```text
   Milestone "<name>" Complete

   Issues: X processed, Y merged, Z failed
   PRs: <list with numbers>

   Failed issues:
   - #N: <reason>
   ```

4. **Send notification:**

   ```text
   Skill(telegram, args: "notify: MILESTONE COMPLETE
   <name>: X/Y issues merged successfully.
   Failed: <list or 'none'>")
   ```

5. **Update checkpoint** status to completed or partial.

---

## Resume Protocol

On start, before Phase 1, check for existing checkpoint state:

```text
checkpoint_workflow_find for each issue in the milestone
```

Resume logic:

| State                            | Action                       |
| -------------------------------- | ---------------------------- |
| Completed + merged               | Skip entirely                |
| Completed + PR open (not merged) | Go to Phase 3 (review cycle) |
| Running/failed + PR exists       | Go to Phase 3 (review cycle) |
| Running/failed + branch, no PR   | Create PR, go to Phase 3     |
| Running/failed + no branch       | Re-execute from Phase 2      |
| No checkpoint                    | Execute normally             |

Also check if a milestone checkpoint already exists:

- If yes and not `--resume` context → suggest using `--resume` flag
- If yes and resuming → load existing waves from checkpoint, skip completed issues

---

## State Management

State tracked in two systems:

1. **Checkpoint DB** (`.claude/execution-state.db`) — source of truth for workflow status, actions, PR numbers
2. **Native tasks** — UI-only progress visualization with wave-based `blockedBy` dependencies

### Worktree Manager Commands

| Command                     | Purpose              |
| --------------------------- | -------------------- |
| `create <issue>`            | Create worktree      |
| `remove <issue>`            | Remove worktree      |
| `status`                    | Show all statuses    |
| `update-status <i> <s> [p]` | Update status        |
| `ci-status <pr> [--wait]`   | Check/wait for CI    |
| `cleanup-all [--force]`     | Remove all worktrees |

---

## Error Handling

| Error                | Behavior                               |
| -------------------- | -------------------------------------- |
| Milestone not found  | Show available, exit                   |
| All issues blocked   | Report cycle, wait for user            |
| Worker failure       | Mark failed, skip dependents, continue |
| CI failure (2x)      | Mark failed, notify user               |
| Network/API failure  | Retry with backoff (max 4)             |
| Telegram unavailable | Continue in terminal                   |

---

## Success Criteria

Workflow succeeds when:

- All free issues processed
- PRs created, reviewed, and merged (per-PR approval)
- Integration on main is stable
- Worktrees cleaned up
- Summary report generated and sent via Telegram
