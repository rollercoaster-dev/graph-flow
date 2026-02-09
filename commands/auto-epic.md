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

2. Create milestone checkpoint for the epic

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

4. Display wave plan:

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

## Phase 2: Execute

Spawn teammates to work through the task list. Wave gating is automatic — tasks in later waves have `blockedBy` dependencies on earlier wave tasks, so teammates can only claim unblocked tasks.

### Sequential (default, `--parallel 1`)

Spawn 1 teammate. It works through tasks in wave order, one at a time:

```text
Task({
  prompt: "You are a worker on team epic-<N>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Execute it by running: Skill(graph-flow:auto-issue, args: '<issue-number>'). When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain. Before each task, run `git checkout main && git pull origin main`.",
  subagent_type: "general-purpose",
  team_name: "epic-<N>",
  name: "worker-1",
  mode: "bypassPermissions"
})
```

### Parallel (`--parallel N`)

Spawn N teammates. They self-claim from the shared task list:

```text
For i in 1..N:
  Task({
    prompt: "You are worker-<i> on team epic-<N>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Execute it by running: Skill(graph-flow:auto-issue, args: '<issue-number>'). When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain. Before each task, run `git checkout main && git pull origin main`.",
    subagent_type: "general-purpose",
    team_name: "epic-<N>",
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

4. **Update epic issue** — check boxes for completed sub-issues:

   ```bash
   # For each closed sub-issue, update checkbox in epic body
   gh issue view <epic> --json body -q '.body'
   # Replace "- [ ] ... #N" with "- [x] ... #N" for closed issues
   gh issue edit <epic> --body "<updated-body>"
   ```

5. **Close epic** if all sub-issues are closed:

   ```bash
   gh issue close <epic>
   ```

6. **Generate summary and send notification:**

   ```text
   Skill(telegram, args: "notify: EPIC COMPLETE
   Epic #<N>: <title>
   Sub-issues: X/Y merged successfully.
   Failed: <list or 'none'>")
   ```

7. **Update checkpoint** status to completed or partial.

---

## Resume Protocol

On start, before Phase 1, check for existing checkpoint state and team:

1. Check if team `epic-<N>` already exists (read `~/.claude/teams/epic-<N>/config.json`)
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

---

## State Management

Same as `/auto-milestone` — state tracked in checkpoint DB (source of truth) and native tasks (UI only). Team task list provides additional coordination state.

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
