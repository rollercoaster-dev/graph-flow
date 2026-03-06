# Multi-Issue Workflow: Shared Phases

Shared execution phases for `/auto-epic` and `/auto-milestone`. Both commands reference this document for Phases 2-4 and Resume Protocol. Each command defines its own Phase 1 (planning) and argument parsing.

**Placeholders:** `<team-name>` refers to the team created in Phase 1 (e.g., `epic-<N>` or `milestone-<name>`).

---

## Phase 2: Execute

Spawn teammates to work through the task list. Dependency gating is automatic — tasks have `blockedBy` edges on their actual dependency issues (not entire waves), so teammates can only claim tasks whose specific dependencies are complete.

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

Spawn N teammates with `isolation: "worktree"`. Claude Code handles worktree creation and cleanup automatically — no manual worktree management needed:

```text
For i in 1..N:
  Task({
    prompt: "You are worker-<i> on team <team-name>. Check TaskList for available (unblocked, unowned) tasks. Claim one with TaskUpdate (set owner to your name, status to in_progress). Execute: Skill(graph-flow:auto-issue, args: '<issue-number>'). When the skill completes, detect the PR number via `gh pr list --search 'head:feat/issue-<issue>' --state open --json number --limit 1`. Mark the task completed and send the lead a message with the PR number. Then check TaskList for the next available task. Repeat until no tasks remain.",
    subagent_type: "general-purpose",
    team_name: "<team-name>",
    name: "worker-<i>",
    mode: "bypassPermissions",
    isolation: "worktree"
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

### Step 2: External Review with Fallback Chain

Every PR should be reviewed by at least one reviewer. Use a **best-effort fallback chain**: CodeRabbit → Copilot → Claude internal review. If one reviewer is unavailable, unsupported for the repo, or times out, try the next.

```text
reviewer_result = null

# ── Attempt 1: CodeRabbit ──
Poll for CodeRabbit review (max 5 min, exponential backoff: 10s, 20s, 40s, 60s, 60s, 60s):
  reviews = gh api repos/rollercoaster-dev/graph-flow/pulls/<N>/reviews
  Look for review from "coderabbitai[bot]"
If found → reviewer_result = { source: "coderabbit", comments: [parsed from review] }

# ── Attempt 2: Copilot (only if CodeRabbit failed/timed out) ──
If reviewer_result is null:
  If the repo supports Copilot review requests:
    request Copilot review
    poll for a Copilot-authored review (max 5 min, same backoff)
  If not supported, or no review appears:
    leave reviewer_result as null
  If found → reviewer_result = { source: "copilot", comments: [parsed from review] }

# ── Attempt 3: Claude internal review (only if both external reviewers failed) ──
If reviewer_result is null:
  Run the review skill as a fallback:
    Skill(graph-flow:review, args: { workflow_id: "pr-<N>-fallback", skip_agents: [], max_retry: 1 })
  reviewer_result = { source: "claude-review", comments: [mapped from findings] }

Log which reviewer was used. Include reviewer source in Telegram notification (Step 4). If all external reviewers fail, record that Claude review was used as the fallback.
```

### Step 3: Structured Comment Triage

Once we have comments from whichever reviewer succeeded, classify each into a category to determine action:

| Category | Criteria | Action |
|----------|----------|--------|
| **BUG** | Logic error, crash, security issue | MUST FIX → route to worker |
| **CORRECTNESS** | Wrong behavior, missing edge case | MUST FIX → route to worker |
| **CONVENTION** | Style, naming, imports | FIX IF EASY → low priority to worker |
| **NITPICK** | Subjective, minor preference | SKIP → note in Telegram |
| **FALSE_POSITIVE** | Reviewer misunderstood the code | SKIP → dismiss on GitHub |

**Classification signals by reviewer source:**

- **CodeRabbit**: Use its severity labels as starting signal (critical→BUG, warning→CORRECTNESS, suggestion→CONVENTION, nitpick→NITPICK)
- **Copilot**: Map "error"→BUG, "warning"→CORRECTNESS, "suggestion"→CONVENTION
- **Claude review**: Already classified by severity — CRITICAL/HIGH→BUG/CORRECTNESS, MEDIUM→CONVENTION, LOW→NITPICK

**Route MUST FIX findings to the worker:**

```text
mustFix = reviewer_result.comments.filter(c => c.category in ["BUG", "CORRECTNESS"])
if mustFix.length > 0:
  SendMessage({
    type: "message",
    recipient: "worker-<i>",
    content: "Review comments on PR #<N> need fixing (source: <reviewer_result.source>):\n\n" +
      mustFix.map(c => "- [<c.category>] <c.file>:<c.line> — <c.message>").join("\n") +
      "\n\nPlease fix, commit, push, and message me when done.",
    summary: "Review fix request for PR #<N> (<mustFix.length> findings from <reviewer_result.source>)"
  })
  # After fix: re-wait for CI
```

**Dismiss FALSE_POSITIVE comments on GitHub** (if the reviewer supports it):

```bash
# Reply or leave a follow-up comment explaining why the finding was judged false positive
```

### Step 4: Telegram Notification (Per-PR)

Before notifying, check dependency status so the user sees the full picture:

```text
# Read dependsOn from this issue's task metadata or the saved wave/dependency plan
deps = task.metadata.dependsOn  # e.g. [636, 637]
depStatus = []
for dep in deps:
  # Check saved checkpoint state first, fall back to GitHub
  cpStatus = checkpoint_record_for_issue(dep)
  if cpStatus and cpStatus.status == "merged":
    depStatus.push("#<dep>: merged ✓")
  else:
    mergedPR = gh pr list --search "head:feat/issue-<dep>" --state merged --json number --limit 1
    if mergedPR:
      depStatus.push("#<dep>: merged ✓")
    else:
      depStatus.push("#<dep>: NOT MERGED ✗")

allDepsMerged = depStatus.every(s => s.includes("✓"))
depLine = deps.length > 0
  ? "Dependencies: " + (allDepsMerged ? "all merged ✓" : depStatus.join(", "))
  : "Dependencies: none"
```

```text
Skill(telegram, args: "ask: PR #<N> for issue #<M> ready for review.
<title>
<pr-url>
CI: <passed/failed> | Review: <reviewer-source> — <X> comments (<Y> addressed)
<depLine>

Reply: merge / changes: <feedback> / skip")
```

### Step 5: Handle Reply

**Guard: Steps 1-3 must have completed before merge.** Even if CI is green and the user says "merge", do NOT merge until review (Step 2) and comment triage (Step 3) have run. If they haven't, run them now before proceeding.

**Guard: Dependency gate.** Before merging, verify all dependency PRs are merged:

```text
# Re-check dependency status at merge time (may have changed since Step 4)
for dep in task.metadata.dependsOn:
  cpStatus = checkpoint_record_for_issue(dep)
  if cpStatus and cpStatus.status == "merged":
    continue
  mergedPR = gh pr list --search "head:feat/issue-<dep>" --state merged --json number --limit 1
  if not mergedPR:
    # Block merge — dependency not yet merged
    Skill(telegram, args: "notify: ⚠️ Cannot merge PR #<N> — dependency #<dep> not yet merged.
    Will auto-retry when #<dep> merges.")
    # Record the blocked PR in lead notes/checkpoint so it can be revisited after dependencies merge
    checkpoint_update(issue: <M>, status: "review-blocked", blockedOn: dep, pr: <N>)
    → skip to next PR (do not merge)
```

**After any successful merge**, re-check blocked review items:

```text
# After merging PR for issue M:
for blocked review item waiting on M:
  # Re-run dependency gate for that PR
  → re-enter Step 5 for blocked.pr
```

- **"merge"** / **"lgtm"** / **"ok"** → verify review steps ran, pass dependency gate, then merge the PR:

  ```bash
  gh pr merge <N> --squash --delete-branch
  ```

  Then update main:

  ```bash
  git checkout main && git pull origin main
  ```

  Then update checkpoint and re-check blocked review items:

  ```text
  checkpoint_update(issue: <M>, status: "merged")
  # Re-check any blocked review items that were waiting on this issue
  for blocked review item waitingOn == M:
    → re-enter Step 5 for blocked.pr
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

   Worktree cleanup is automatic when using `isolation: "worktree"` on Task calls. Claude Code removes worktrees when the task completes. Run `git worktree prune` if any stale entries remain:

   ```bash
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

On `--continue`, reconstruct state from **both** checkpoint records and live GitHub state. Checkpoint provides the saved status; GitHub provides the current truth.

### Step 1: Load Checkpoint

```text
Read checkpoint records for <scope identifier>
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

## Review Architecture

The workflow uses a **two-layer review model**. Both layers are intentional — they catch different classes of issues at different stages.

### Layer 1: Pre-PR (Internal Agents + Auto-Fix)

Runs inside `/auto-issue` **before** the PR is created. Uses the `/review` skill which spawns `code-reviewer`, `test-analyzer`, and `silent-failure-hunter` in parallel.

- **Scope:** Code quality, test gaps, silent failures, OB compliance (if applicable)
- **Fix path:** Automatic — the auto-fixer agent attempts fixes for CRITICAL findings, commits directly to the branch
- **Outcome:** PR is created only after critical issues are resolved (or escalated to user)

### Layer 2: Post-PR (External Reviewer + Telegram Approval)

Runs **after** the PR exists, as part of Phase 3's per-PR review cycle (Steps 2-3).

- **Scope:** Higher-level design issues, cross-file patterns, API misuse — things that benefit from seeing the full PR diff in context
- **Reviewer:** Best-effort fallback chain (CodeRabbit → Copilot → Claude internal review) aims to keep every PR reviewed even if one service is down or unsupported
- **Fix path:** Structured triage (BUG/CORRECTNESS/CONVENTION/NITPICK/FALSE_POSITIVE) routes findings to the worker with clear instructions. No auto-fix — the worker implements fixes.
- **Outcome:** User makes final merge decision via Telegram with full visibility into review status and dependency readiness

### Why Two Layers?

| Aspect | Layer 1 (Pre-PR) | Layer 2 (Post-PR) |
|--------|-------------------|---------------------|
| When | Before PR creation | After PR exists |
| Who | Internal review agents | External reviewer (CodeRabbit/Copilot/Claude) |
| What it catches | Code-level bugs, test gaps, silent failures | Design issues, cross-file patterns, API misuse |
| Fix mechanism | Auto-fix loop (automated) | Worker fix with structured instructions (human-guided) |
| Escalation | To user if auto-fix fails | To user via Telegram for merge decision |

Layer 1 catches the mechanical issues that are easy to auto-fix. Layer 2 catches the higher-level issues that benefit from a full PR diff view and human judgment.

---

## State Management

State tracked in three systems:

1. **Checkpoint records** (`.claude/workflows/`) — source of truth for workflow status, actions, PR numbers, and any temporarily blocked review state
2. **Native tasks** — progress visualization with per-issue `blockedBy` dependency edges. Task metadata may also carry `dependsOn` issue numbers for review-time dependency checks
3. **Team task list** — coordination state for teammate self-claiming
