# /auto-epic $ARGUMENTS

Claude-as-orchestrator for epic execution. Reads GitHub sub-issues and native dependency graph, computes waves inline, and uses native agent teams to execute sub-issues with per-PR Telegram approval.

**Mode:** Autonomous — no gates, uses explicit GitHub dependencies (no inference needed).

**Architecture:** Claude IS the orchestrator (team lead). Workers are managed teammates spawned via the `Task` tool with `team_name`. Wave computation is inline (epic deps are explicit in GitHub — no planner needed).

**Recommended:** Run in tmux for remote observability:

```bash
tmux new -s epic
claude
/auto-epic 635
```

---

## CRITICAL: Branch Isolation is Non-Negotiable

**YOU MUST NEVER commit directly to `main` during this workflow.**

Each sub-issue gets its own branch → PR → review → merge. See `/auto-milestone` for the full rationale.

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
  team_name: "epic-<N>",
  name: "worker-95",
  mode: "bypassPermissions"
})
```

The only exception is calling the `telegram` skill via the Skill tool (lightweight, no agent context).

---

## CRITICAL: Worktree Isolation for Parallel Mode

**When using `--parallel N` (N > 1), workers MUST operate in separate git worktrees.** Without worktree isolation, concurrent workers conflict on git state — one does `git checkout main` while another is mid-implementation.

- **Parallel mode (`--parallel N > 1`):** Lead creates worktrees in Phase 1 (Step 4) using `./scripts/worktree-manager.sh create <issue-number>`. Each task's metadata includes `worktreePath`. Workers `cd` to their worktree before running the auto-issue skill.
- **Sequential mode (`--parallel 1`):** No worktrees needed — single worker uses the main checkout.

---

## When to Use Parallel Mode

| Scenario | Recommendation |
|----------|---------------|
| Small epic (<5 issues), sequential deps | `--parallel 1` (default) |
| Large wave of 3+ independent issues | `--parallel N` (N = largest wave size) |
| CI-heavy, want overlapping feedback | `--parallel 2-3` |
| Don't exceed largest wave size | Extra workers just idle |

---

## Quick Reference

```bash
/auto-epic 635                    # All sub-issues of epic #635 (sequential)
/auto-epic 635 --dry-run          # Analyze only, show execution plan
/auto-epic 635 --parallel 3       # Run 3 sub-issues concurrently
/auto-epic 635 --wave 1           # Only run first wave
/auto-epic 635 --skip-ci          # Skip waiting for CI
```

## Configuration

| Setting      | Default | Description                   |
| ------------ | ------- | ----------------------------- |
| `--parallel` | 1       | Max concurrent teammate workers |
| `--dry-run`  | false   | Analyze and plan only         |
| `--wave`     | all     | Only run specific wave        |
| `--skip-ci`  | false   | Skip waiting for CI           |

---

## How Epics Differ from Milestones

| Aspect           | `/auto-milestone`                  | `/auto-epic`                             |
| ---------------- | ---------------------------------- | ---------------------------------------- |
| Input            | Milestone name or issue numbers    | Epic issue number                        |
| Dependencies     | Inferred by milestone-planner      | Explicit in GitHub (blocking/blocked-by) |
| Wave computation | Milestone-planner teammate         | Claude inline via `gh api`               |
| Scope            | All open issues in milestone       | Sub-issues of one parent issue           |
| Planner needed   | Yes (teammate)                     | No — deps already in GitHub              |

Epic is leaner: dependencies are already declared in GitHub, so no planner process is needed.

---

## Workflow

```text
Phase 1: Plan    → read GitHub sub-issue graph → compute waves → create team + tasks
Phase 2: Execute → spawn teammates → they self-claim unblocked tasks via Skill(auto-issue)
Phase 3: Review  → per-PR: CI → CodeRabbit → fix → Telegram approval → merge
Phase 4: Cleanup → shutdown teammates, delete team, update epic, summary, notification
```

---

## Argument Parsing

Parse `$ARGUMENTS`:

| Pattern           | Example                      |
| ----------------- | ---------------------------- |
| Single number     | `635`                        |
| Number with flags | `635 --dry-run --parallel 3` |

**Validation:**

- Empty arguments → Error: "Usage: /auto-epic <epic-issue-number>"
- Non-existent issue → Error: "Issue #X not found"
- Issue with no sub-issues → Error: "Issue #X has no sub-issues. Use /graph-flow:auto-issue for single issues."

---

## Phase 1: Plan

Unlike `/auto-milestone`, this phase does NOT use a planner. Claude reads the dependency graph directly from GitHub.

### Step 1: Fetch Sub-Issues

```bash
gh api graphql -f query='query {
  repository(owner: "rollercoaster-dev", name: "graph-flow") {
    issue(number: <N>) {
      title
      subIssues(first: 50) {
        nodes {
          number
          title
          state
          closedAt
        }
      }
    }
  }
}'
```

### Step 2: Read Dependency Graph

For each sub-issue, extract blocking relationships from the issue body:

```bash
gh issue view <N> --json body -q '.body' | grep -oiE '(blocked by|depends on|after) #[0-9]+' | grep -oE '#[0-9]+'
```

This parses explicit dependency declarations like "Blocked by #636" or "Depends on #637" from the issue body text. Epic sub-issues in this project use this convention consistently.

### Step 3: Compute Waves

From the dependency topology:

- **Wave 1**: Sub-issues with no blockers (or all blockers already closed)
- **Wave 2**: Sub-issues blocked only by Wave 1 issues
- **Wave N**: Sub-issues blocked only by Wave 1..N-1 issues

Filter out already-closed sub-issues (they're done).

Detect circular dependencies — if found, report and exit.

### Step 4: Create Team, Checkpoint, Tasks + Display Plan

1. Create the agent team:

   ```text
   TeamCreate({ team_name: "epic-<N>", description: "Epic #<N>: <title>" })
   ```

2. Create checkpoint entries for **every** open issue immediately — this is the foundation for `--continue`:

   ```text
   For each open issue N:
     checkpoint_workflow_create(issue: N, epic: <epic>, wave: W, status: "pending")
   ```

   This ensures `--continue` has real data to resume from even if the workflow is interrupted before any worker starts.

3. Create native tasks with wave-based dependencies:

   ```text
   For each wave W (1..N):
     For each issue in wave W:
       taskId = TaskCreate({
         subject: "Issue #<N>: <title>",
         description: "Execute Skill(graph-flow:auto-issue, args: '<N>'). Report PR number when done.",
         activeForm: "Working on issue #<N>",
         metadata: { issueNumber: <N>, waveNumber: W, epicNumber: <epic> }
       })
       if W > 1:
         TaskUpdate(taskId, { addBlockedBy: [task IDs from previous wave] })
       waveWTasks.push(taskId)

   TaskList() → Show full epic tree immediately
   ```

   **Update checkpoints as execution progresses** — after each significant state change:

   ```text
   Worker spawned    → checkpoint_update(issue: N, status: "running")
   PR created        → checkpoint_update(issue: N, status: "review", pr: <pr-number>)
   PR merged         → checkpoint_update(issue: N, status: "merged")
   Worker failed     → checkpoint_update(issue: N, status: "failed", error: <msg>)
   ```

4. **If parallel mode (`--parallel N > 1`)**, create worktrees for all open issues and add paths to task metadata:

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

5. Display wave plan:

   ```text
   Epic #635: Planning Graph Phase 2 — generic Plan/Step model
   Sub-issues: 7 total, 0 closed, 7 open

   Wave 1 (no blockers):
     #636 - Add Plan and PlanStep tables to planning graph

   Wave 2 (after Wave 1):
     #637 - MCP tools for Plan CRUD operations → blocked by #636
     #638 - Completion resolver system → blocked by #636

   Wave 3 (after Wave 2):
     #639 - Enhanced /plan status → blocked by #637, #638
     #640 - /plan create command → blocked by #637

   Wave 4 (after Wave 3):
     #641 - /plan start command → blocked by #637, #639

   Wave 5 (after Wave 4):
     #642 - Auto-pop stale detection → blocked by #638, #641

   Execution order: 5 waves, 7 issues. Ready to start.
   ```

**If `--dry-run`:** Stop here, display plan, exit. Also clean up the team:

```text
TeamDelete()
```

---

## Phases 2-4 and Resume: Shared Workflow

**See [docs/multi-issue-workflow.md](../docs/multi-issue-workflow.md)** for the shared execution phases:

- **Phase 2: Execute** — teammate spawning, self-claiming, pre-existing work detection, failure handling
- **Phase 3: Per-PR Review Cycle** — CI wait, CodeRabbit, comment triage, Telegram approval, merge
- **Phase 4: Cleanup** — teammate shutdown, worktree cleanup, team deletion, checkpoint update

Use `team_name: "epic-<N>"` when following the shared workflow.

### Epic-Specific Cleanup (after shared Phase 4 steps 1-4)

After the shared cleanup steps, perform epic-specific cleanup:

5. **Update epic issue** — check boxes for completed sub-issues:

   ```bash
   # For each closed sub-issue, update checkbox in epic body
   gh issue view <epic> --json body -q '.body'
   # Replace "- [ ] ... #N" with "- [x] ... #N" for closed issues
   gh issue edit <epic> --body "<updated-body>"
   ```

6. **Close epic** if all sub-issues are closed:

   ```bash
   gh issue close <epic>
   ```

7. **Generate summary and send notification:**

   ```text
   Skill(telegram, args: "notify: EPIC COMPLETE
   Epic #<N>: <title>
   Sub-issues: X/Y merged successfully.
   Failed: <list or 'none'>")
   ```

8. **Update checkpoint** status to completed or partial.

### Resume Protocol

See [docs/multi-issue-workflow.md — Resume Protocol](../docs/multi-issue-workflow.md#resume-protocol). Use team name `epic-<N>` and scope identifier `epic <N>`.

---

## Error Handling

| Error                 | Behavior                               |
| --------------------- | -------------------------------------- |
| Epic not found        | Report error, exit                     |
| No sub-issues         | Suggest /graph-flow:auto-issue instead |
| Circular deps         | Report cycle, wait for user            |
| All sub-issues closed | Report "nothing to do", exit           |
| Teammate failure      | Mark failed, skip dependents, continue |
| CI failure (2x)       | Mark failed, notify user               |
| Network/API failure   | Retry with backoff (max 4)             |
| Telegram unavailable  | Continue in terminal                   |

---

## Success Criteria

Workflow succeeds when:

- All open sub-issues processed
- PRs created, reviewed, and merged (per-PR approval)
- Epic issue updated (checkboxes, optionally closed)
- Team cleaned up (teammates shut down, team deleted)
- Summary report generated and sent via Telegram
