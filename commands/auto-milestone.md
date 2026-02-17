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

## Phases 2-4 and Resume: Shared Workflow

**See [docs/multi-issue-workflow.md](../docs/multi-issue-workflow.md)** for the shared execution phases:

- **Phase 2: Execute** — teammate spawning, self-claiming, pre-existing work detection, failure handling
- **Phase 3: Per-PR Review Cycle** — CI wait, CodeRabbit, comment triage, Telegram approval, merge
- **Phase 4: Cleanup** — teammate shutdown, worktree cleanup, team deletion, checkpoint update

Use `team_name: "milestone-<sanitized-name>"` when following the shared workflow.

### Milestone-Specific Cleanup (after shared Phase 4 steps 1-4)

After the shared cleanup steps, perform milestone-specific cleanup:

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

### Resume Protocol

See [docs/multi-issue-workflow.md — Resume Protocol](../docs/multi-issue-workflow.md#resume-protocol). Use team name `milestone-<sanitized-name>` and scope identifier `milestone <name>`.

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
