# /auto-milestone $ARGUMENTS

Claude-as-orchestrator for milestone execution. No intermediate scripts — Claude uses native agent teams to plan and execute, manages PRs via `gh`, and runs per-PR Telegram approval cycles.

**Mode:** Autonomous with planning gate — only stops if dependencies are unclear.

**Architecture:** Claude IS the orchestrator (team lead). Workers are managed teammates spawned via the `Task` tool with `team_name`. Planning uses a teammate with the milestone-planner agent protocol.

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

## CRITICAL: Use Agent Teams — Not `claude -p`

**YOU MUST use native agent teams (TeamCreate, Task with team_name, SendMessage) for all worker execution.** Do NOT use `claude -p` to spawn workers.

Each teammate executes the `/graph-flow:auto-issue` skill via `Skill(graph-flow:auto-issue, args: "<N>")`. The skill handles everything: branch creation, implementation, testing, PR creation.

**WRONG — DO NOT DO THIS:**
```bash
# WRONG: Do not use claude -p
claude -p "/graph-flow:auto-issue 95" --model opus ...
# WRONG: Do not write inline prompts
claude -p "You are working on issue #95..." ...
```

**RIGHT — DO THIS:**
```text
# Spawn a teammate that runs the skill
Task({
  prompt: "Execute Skill(graph-flow:auto-issue, args: '95'). When done, mark your task completed and send me the PR number.",
  subagent_type: "general-purpose",
  team_name: "milestone-<name>",
  name: "worker-95",
  mode: "bypassPermissions"
})
```

The only exception is calling the `telegram` skill via the Skill tool (lightweight, no agent context).

---

## CRITICAL: Worktree Isolation for Parallel Mode

**When using `--parallel N` (N > 1), workers MUST operate in separate git worktrees.** Without worktree isolation, concurrent workers conflict on git state — one does `git checkout main` while another is mid-implementation.

- **Parallel mode (`--parallel N > 1`):** Lead creates worktrees in Phase 1 (Step 3) using `./scripts/worktree-manager.sh create <issue-number>`. Each task's metadata includes `worktreePath`. Workers `cd` to their worktree before running the auto-issue skill.
- **Sequential mode (`--parallel 1`):** No worktrees needed — single worker uses the main checkout.

---

## When to Use Parallel Mode

| Scenario | Recommendation |
|----------|---------------|
| Small milestone (<5 issues), sequential deps | `--parallel 1` (default) |
| Large wave of 3+ independent issues | `--parallel N` (N = largest wave size) |
| CI-heavy, want overlapping feedback | `--parallel 2-3` |
| Don't exceed largest wave size | Extra workers just idle |

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

| Setting      | Default | Description                   |
| ------------ | ------- | ----------------------------- |
| `--parallel` | 1       | Max concurrent teammate workers |
| `--dry-run`  | false   | Analyze and plan only         |
| `--wave`     | all     | Only run specific wave        |
| `--skip-ci`  | false   | Skip waiting for CI           |

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
      description: "Execute Skill(graph-flow:auto-issue, args: '<N>'). Report PR number when done.",
      activeForm: "Working on issue #<N>",
      metadata: { issueNumber: <N>, waveNumber: W, milestoneId: <id> }
    })
    if W > 1:
      TaskUpdate(taskId, { addBlockedBy: [task IDs from previous wave] })
    waveWTasks.push(taskId)

TaskList() → Show full milestone tree immediately
```

### Task Updates During Execution

```text
Teammates self-manage task status:

On claiming a task:
  TaskUpdate(taskId, { owner: "worker-<i>", status: "in_progress" })

On completion (PR created):
  TaskUpdate(taskId, { status: "completed" })

On failure:
  TaskUpdate(taskId, { status: "completed", metadata: { failed: true, error } })

After each wave completes:
  TaskList() → Show wave progress, next wave unblocked
```

---

## Workflow

```text
Phase 1: Plan    → milestone-planner teammate → GATE (if dependencies unclear) → create team + tasks
Phase 2: Execute → spawn teammates → they self-claim unblocked tasks via Skill(auto-issue)
Phase 3: Review  → per-PR: CI → CodeRabbit → fix → Telegram approval → merge
Phase 4: Cleanup → shutdown teammates, delete team, summary, notification
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

### Step 1: Create Team

```text
TeamCreate({ team_name: "milestone-<sanitized-name>", description: "Milestone: <name>" })
```

### Step 2: Wave Computation

Spawn a planner teammate to analyze dependencies:

```text
Task({
  prompt: "Analyze milestone '<name>' for the rollercoaster-dev/graph-flow repository. Fetch all open issues in the milestone, analyze their dependencies (from issue bodies and references), and return the execution plan. Output JSON with: execution_waves[] (ordered list of {wave: N, issues: [{number, title, blockedBy}]}), dependency_graph, free_issues[], planning_status ('ready' or 'needs_review'). Use `gh` CLI to fetch milestone issues and their details.",
  subagent_type: "general-purpose",
  team_name: "milestone-<sanitized-name>",
  name: "planner",
  mode: "bypassPermissions"
})
```

The planner returns:

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
- Other text → treat as feedback, send to planner teammate to re-plan

**If `planning_status == "ready"`:** proceed directly.

### Step 3: Checkpoint + Task Creation

After wave plan is confirmed:

1. Create checkpoint entries for **every** open issue immediately — this is the foundation for `--continue`:

   ```text
   For each open issue N:
     checkpoint_workflow_create(issue: N, milestone: <name>, wave: W, status: "pending")
   ```

   This ensures `--continue` has real data to resume from even if the workflow is interrupted before any worker starts.

2. Create native tasks with wave-based dependencies (see Task System Integration above)

   **Update checkpoints as execution progresses** — after each significant state change:

   ```text
   Worker spawned    → checkpoint_update(issue: N, status: "running")
   PR created        → checkpoint_update(issue: N, status: "review", pr: <pr-number>)
   PR merged         → checkpoint_update(issue: N, status: "merged")
   Worker failed     → checkpoint_update(issue: N, status: "failed", error: <msg>)
   ```

3. **If parallel mode (`--parallel N > 1`)**, create worktrees for all open issues and add paths to task metadata:

   ```bash
   # Create worktrees for all open issues
   for each open issue N:
     ./scripts/worktree-manager.sh create <N>
   ```

   Then update each task with the worktree path:

   ```text
   For each task:
     worktreePath = ~/Code/worktrees/graph-flow-issue-<N>
     TaskUpdate(taskId, { metadata: { worktreePath: worktreePath } })
   ```

4. Display wave plan:

   ```text
   Milestone "<name>" — N issues in M waves

   Wave 1 (no blockers):
     #153 - Add KeyPair type
     #154 - Implement generator

   Wave 2 (after Wave 1):
     #155 - Add storage service → blocked by #153
   ```

**If `--dry-run`:** Stop here, display plan, exit. Clean up:

```text
TeamDelete()
```

---

## Phase 2: Execute

Spawn teammates to work through the task list. Wave gating is automatic — tasks in later waves have `blockedBy` dependencies on earlier wave tasks.

### Sequential (default, `--parallel 1`)

Spawn 1 teammate:

```text
Task({
  prompt: "You are a worker on team milestone-<name>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Execute it by running: Skill(graph-flow:auto-issue, args: '<issue-number>'). When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain. Before each task, run `git checkout main && git pull origin main`.",
  subagent_type: "general-purpose",
  team_name: "milestone-<name>",
  name: "worker-1",
  mode: "bypassPermissions"
})
```

### Parallel (`--parallel N`)

Spawn N teammates that self-claim from the shared task list. Each task has a `worktreePath` in its metadata — workers **must** `cd` to that path before executing the skill:

```text
For i in 1..N:
  Task({
    prompt: "You are worker-<i> on team milestone-<name>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Read the task's metadata for worktreePath. cd to that worktree path FIRST, then execute: Skill(graph-flow:auto-issue, args: '<issue-number>'). The branch is already created in the worktree — the auto-issue skill will detect it. When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain.",
    subagent_type: "general-purpose",
    team_name: "milestone-<name>",
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

- Log failure details
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

5. **Generate summary:**

   ```text
   Milestone "<name>" Complete

   Issues: X processed, Y merged, Z failed
   PRs: <list with numbers>

   Failed issues:
   - #N: <reason>
   ```

6. **Send notification:**

   ```text
   Skill(telegram, args: "notify: MILESTONE COMPLETE
   <name>: X/Y issues merged successfully.
   Failed: <list or 'none'>")
   ```

7. **Update checkpoint** status to completed or partial.

---

## Resume Protocol

On `--continue`, reconstruct state from **both** checkpoint DB and live GitHub state. Checkpoint provides the saved status; GitHub provides the current truth.

### Step 1: Load Checkpoint

```text
Read checkpoint DB for milestone <name>
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

1. Check if team `milestone-<name>` exists (read `~/.claude/teams/milestone-<name>/config.json`)
2. If team exists → resume with existing team, reconcile TaskList with checkpoint
3. If no team → create fresh team, create tasks only for non-skipped issues
4. Display reconciled plan showing what was completed vs. what remains

---

## State Management

State tracked in two systems:

1. **Checkpoint DB** (`.claude/execution-state.db`) — source of truth for workflow status, actions, PR numbers
2. **Native tasks** — UI-only progress visualization with wave-based `blockedBy` dependencies
3. **Team task list** — coordination state for teammate self-claiming

---

## Error Handling

| Error                | Behavior                               |
| -------------------- | -------------------------------------- |
| Milestone not found  | Show available, exit                   |
| All issues blocked   | Report cycle, wait for user            |
| Teammate failure     | Mark failed, skip dependents, continue |
| CI failure (2x)      | Mark failed, notify user               |
| Network/API failure  | Retry with backoff (max 4)             |
| Telegram unavailable | Continue in terminal                   |

---

## Success Criteria

Workflow succeeds when:

- All free issues processed
- PRs created, reviewed, and merged (per-PR approval)
- Integration on main is stable
- Team cleaned up (teammates shut down, team deleted)
- Summary report generated and sent via Telegram
