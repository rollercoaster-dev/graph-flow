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

1. Create milestone in checkpoint DB:

   ```text
   checkpoint_workflow_create for each issue
   ```

2. Create native tasks with wave-based dependencies (see Task System Integration above)

3. Display wave plan:

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

Spawn N teammates that self-claim from the shared task list:

```text
For i in 1..N:
  Task({
    prompt: "You are worker-<i> on team milestone-<name>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Execute it by running: Skill(graph-flow:auto-issue, args: '<issue-number>'). When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain. Before each task, run `git checkout main && git pull origin main`.",
    subagent_type: "general-purpose",
    team_name: "milestone-<name>",
    name: "worker-<i>",
    mode: "bypassPermissions"
  })
```

### Pre-existing Work Detection

Before spawning teammates, check each issue for pre-existing work:

1. **Existing PR:** `gh pr list --search "head:feat/issue-<N>"` → mark task completed, note PR number
2. **Existing branch with commits:** `git rev-list --count origin/main..origin/feat/issue-<N>` → note in task description that only PR creation is needed
3. Already closed → mark task completed, skip

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

- **"merge"** / **"lgtm"** / **"ok"** → merge the PR:

  ```bash
  gh pr merge <N> --squash --delete-branch
  ```

  Then update main:

  ```bash
  git checkout main && git pull origin main
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

2. **Delete team:**

   ```text
   TeamDelete()
   ```

3. **Ensure repo on main:**

   ```bash
   git checkout main && git pull origin main
   ```

4. **Generate summary:**

   ```text
   Milestone "<name>" Complete

   Issues: X processed, Y merged, Z failed
   PRs: <list with numbers>

   Failed issues:
   - #N: <reason>
   ```

5. **Send notification:**

   ```text
   Skill(telegram, args: "notify: MILESTONE COMPLETE
   <name>: X/Y issues merged successfully.
   Failed: <list or 'none'>")
   ```

6. **Update checkpoint** status to completed or partial.

---

## Resume Protocol

On start, before Phase 1, check for existing checkpoint state and team:

1. Check if team `milestone-<name>` already exists (read `~/.claude/teams/milestone-<name>/config.json`)
2. If team exists → resume with existing team, check TaskList for progress
3. If no team → check checkpoint DB for prior state

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
