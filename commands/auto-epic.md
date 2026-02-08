# /auto-epic $ARGUMENTS

Claude-as-orchestrator for epic execution. Reads GitHub sub-issues and native dependency graph, computes waves inline, and spawns `claude -p` workers with per-PR Telegram approval.

**Mode:** Autonomous — no gates, uses explicit GitHub dependencies (no inference needed).

**Architecture:** Claude IS the orchestrator. Workers are separate `claude -p` processes (Opus 4.5). Wave computation is inline (epic deps are explicit in GitHub -- no planner needed).

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
/auto-epic 635                    # All sub-issues of epic #635 (sequential)
/auto-epic 635 --dry-run          # Analyze only, show execution plan
/auto-epic 635 --parallel 3       # Run 3 sub-issues concurrently
/auto-epic 635 --wave 1           # Only run first wave
/auto-epic 635 --skip-ci          # Skip waiting for CI
```

## Configuration

| Setting      | Default | Description                  |
| ------------ | ------- | ---------------------------- |
| `--parallel` | 1       | Max concurrent issue workers |
| `--dry-run`  | false   | Analyze and plan only        |
| `--wave`     | all     | Only run specific wave       |
| `--skip-ci`  | false   | Skip waiting for CI          |

---

## How Epics Differ from Milestones

| Aspect           | `/auto-milestone`                  | `/auto-epic`                             |
| ---------------- | ---------------------------------- | ---------------------------------------- |
| Input            | Milestone name or issue numbers    | Epic issue number                        |
| Dependencies     | Inferred by milestone-planner      | Explicit in GitHub (blocking/blocked-by) |
| Wave computation | `claude -p` with milestone-planner | Claude inline via `gh api`               |
| Scope            | All open issues in milestone       | Sub-issues of one parent issue           |
| Planner needed   | Yes (Sonnet process)               | No — deps already in GitHub              |

Epic is leaner: dependencies are already declared in GitHub, so no planner process is needed.

---

## Task System Integration

Same pattern as `/auto-milestone`. Create ALL tasks upfront after Phase 1, with wave-based `blockedBy` dependencies. See `/auto-milestone` for the full task creation and update patterns.

---

## Workflow

```text
Phase 1: Plan    → read GitHub sub-issue graph → compute waves inline
Phase 2: Execute → per-wave: launch claude -p /auto-issue N (Opus 4.5)
Phase 3: Review  → per-PR: CI → CodeRabbit → fix → Telegram approval → merge
Phase 4: Cleanup → remove worktrees, update epic, summary, notification
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
- Issue with no sub-issues → Error: "Issue #X has no sub-issues. Use /auto-issue for single issues."

---

## Phase 1: Plan

Unlike `/auto-milestone`, this phase does NOT use the milestone-planner. Claude reads the dependency graph directly from GitHub.

### Step 1: Fetch Sub-Issues

```bash
gh api graphql -f query='query {
  repository(owner: "rollercoaster-dev", name: "monorepo") {
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

### Step 4: Create Checkpoint + Tasks, Display Plan

1. Create milestone checkpoint for the epic
2. Create native tasks for wave visualization (see `/auto-milestone` Task System Integration)
3. Display wave plan:

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

**If `--dry-run`:** Stop here, display plan, exit.

---

## Phase 2: Execute

For each sub-issue in wave order (up to `--parallel` limit, default: 1 sequential):

1. **Skip closed sub-issues** — already done, no work needed

2. **Check for pre-existing work** (same as `/auto-milestone`):
   - Existing PR → skip
   - Existing branch with commits → create PR only
   - Nothing → full execution

3. **Ensure repo on main:**

   ```bash
   git checkout main && git pull origin main
   ```

4. **Launch worker:**

   ```bash
   claude -p "/auto-issue <N>" --max-budget-usd 5 --model opus \
     --output-format text --dangerously-skip-permissions \
     > .claude/output/issue-<N>.log 2>&1
   ```

5. **Detect PR:**

   ```bash
   gh pr list --search "head:feat/issue-<N>" --state open --json number,headRefName --limit 1
   ```

6. **Update checkpoint and task status**

### Wave Gating

Wait for ALL issues in current wave to complete (PR created) before starting next wave. Skip issues whose blockers failed.

### Failure Handling

If a sub-issue fails:

- Log failure with error details
- Mark dependent sub-issues as skipped
- Continue with remaining independent sub-issues in current wave
- Report skipped issues in summary

---

## Phase 3: Per-PR Review Cycle

**Identical to `/auto-milestone` Phase 3.** For each PR: wait for CI, wait for CodeRabbit, address comments, send Telegram notification, handle reply (merge/changes/skip). See `/auto-milestone` for full step-by-step details.

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

3. **Update epic issue** — check boxes for completed sub-issues:

   ```bash
   # For each closed sub-issue, update checkbox in epic body
   gh issue view <epic> --json body -q '.body'
   # Replace "- [ ] ... #N" with "- [x] ... #N" for closed issues
   gh issue edit <epic> --body "<updated-body>"
   ```

4. **Close epic** if all sub-issues are closed:

   ```bash
   gh issue close <epic>
   ```

5. **Generate summary and send notification:**

   ```text
   Skill(telegram, args: "notify: EPIC COMPLETE
   Epic #<N>: <title>
   Sub-issues: X/Y merged successfully.
   Failed: <list or 'none'>")
   ```

6. **Update checkpoint** status to completed or partial.

---

## Resume Protocol

Same as `/auto-milestone`. On start, check for existing checkpoint state and resume at the appropriate phase. See `/auto-milestone` Resume Protocol for the full state-to-action table.

---

## State Management

Same as `/auto-milestone` — state tracked in checkpoint DB (source of truth) and native tasks (UI only).

---

## Error Handling

| Error                 | Behavior                               |
| --------------------- | -------------------------------------- |
| Epic not found        | Report error, exit                     |
| No sub-issues         | Suggest /auto-issue instead            |
| Circular deps         | Report cycle, wait for user            |
| All sub-issues closed | Report "nothing to do", exit           |
| Worker failure        | Mark failed, skip dependents, continue |
| CI failure (2x)       | Mark failed, notify user               |
| Network/API failure   | Retry with backoff (max 4)             |
| Telegram unavailable  | Continue in terminal                   |

---

## Success Criteria

Workflow succeeds when:

- All open sub-issues processed
- PRs created, reviewed, and merged (per-PR approval)
- Epic issue updated (checkboxes, optionally closed)
- Worktrees cleaned up
- Summary report generated and sent via Telegram
