# /work-on-issue <issue-number>

Gated workflow requiring human approval at each phase.

**Mode:** Supervised - 4 hard gates, explicit approval required at each.

## Quick Reference

```bash
/work-on-issue 123              # Standard gated workflow
/work-on-issue 123 --skip-review # Skip Gate 4 (pre-PR review)
```

## Task System Integration

Native task tracking provides progress visualization during the workflow. Tasks are supplementary to the checkpoint system (which remains source of truth).

### Task Creation Pattern

Create ALL tasks upfront after Phase 1 Setup, with blockedBy dependencies:

```text
After Phase 1 Setup completes, create all tasks at once:

  gate1 = TaskCreate({
    subject: "Gate 1: Review Issue #<N>",
    description: "Review issue details, check blockers, validate requirements",
    activeForm: "Reviewing issue #<N>",
    metadata: { issueNumber: <N>, workflowId, phase: "research", gate: 1 }
  })

  gate2 = TaskCreate({
    subject: "Gate 2: Review Plan for #<N>",
    description: "Review development plan, approve implementation approach",
    activeForm: "Reviewing plan",
    metadata: { issueNumber: <N>, workflowId, phase: "research", gate: 2 }
  })
  TaskUpdate(gate2, { addBlockedBy: [gate1] })

  gate3 = TaskCreate({
    subject: "Gate 3: Implement #<N>",
    description: "Implement changes per plan, review each commit",
    activeForm: "Implementing changes",
    metadata: { issueNumber: <N>, workflowId, phase: "implement", gate: 3 }
  })
  TaskUpdate(gate3, { addBlockedBy: [gate2] })

  gate4 = TaskCreate({
    subject: "Gate 4: Pre-PR Review for #<N>",
    description: "Run review agents, address critical findings",
    activeForm: "Running reviews",
    metadata: { issueNumber: <N>, workflowId, phase: "review", gate: 4 }
  })
  TaskUpdate(gate4, { addBlockedBy: [gate3] })

  finalize = TaskCreate({
    subject: "Finalize: Create PR for #<N>",
    description: "Push branch, create PR, update board",
    activeForm: "Finalizing PR",
    metadata: { issueNumber: <N>, workflowId, phase: "finalize" }
  })
  TaskUpdate(finalize, { addBlockedBy: [gate4] })

  TaskList() → Show full workflow tree immediately
```

### Task Updates During Workflow

Update status as gates progress:

```text
Starting Gate 1:
  TaskUpdate(gate1, { status: "in_progress" })

Gate 1 Approved:
  TaskUpdate(gate1, { status: "completed" })
  TaskUpdate(gate2, { status: "in_progress" })

Gate 2 Approved:
  TaskUpdate(gate2, { status: "completed" })
  TaskUpdate(gate3, { status: "in_progress" })

Gate 3 Approved:
  TaskUpdate(gate3, { status: "completed" })
  TaskUpdate(gate4, { status: "in_progress" })

Gate 4 Approved:
  TaskUpdate(gate4, { status: "completed" })
  TaskUpdate(finalize, { status: "in_progress" })

PR Created:
  TaskUpdate(finalize, { status: "completed" })
  TaskList() → Show final progress summary
```

### Progress Visualization

After each gate, display progress with `TaskList()`:

```text
Tasks for Issue #123:
├─ Gate 1: Review Issue #123      [COMPLETED]
├─ Gate 2: Review Plan for #123   [COMPLETED]
├─ Gate 3: Implement #123         [IN_PROGRESS]
├─ Gate 4: Pre-PR Review for #123 [PENDING, blocked by Gate 3]
└─ Finalize: Create PR for #123   [PENDING, blocked by Gate 4]
```

### Key Points

- **Checkpoint remains source of truth** - Tasks provide UI only
- **blockedBy enforces sequence** - Prevents gate skipping
- **Tasks are supplementary** - Workflow continues if task operations fail
- **Metadata links to checkpoint** - Enables cross-reference for debugging

---

## Workflow

```
Phase 1: Setup     → Skill(setup)           → GATE 1 (Issue Review)
Phase 2: Research  → Task(issue-researcher)  → GATE 2 (Plan Review)
Phase 3: Implement → (orchestrator inline)   → GATE 3 (per commit)
Phase 4: Review    → Skill(review)           → GATE 4 (Pre-PR Review)
Phase 5: Finalize  → Skill(finalize)
```

---

## Phase 1: Setup

```
Skill(setup):
  Input:  { issue_number: <N> }
  Output: { branch, issue }
```

The setup skill will:

- Check for existing workflow (offer resume if found)
- Fetch issue details
- Create feature branch
- Add issue to board as "In Progress"
- Send notification via `telegram` skill

---

## GATE 1: Issue Review

**STOP** - Hard gate requiring explicit approval.

**Show to user:**

- Full issue title and number
- Full body (verbatim - do NOT summarize)
- Labels and milestone
- Blockers if any

**Ask via `telegram` skill** (or terminal):

> Issue #<N>: <title>
>
> <summary>
>
> Proceed with this issue? (yes/no)

**Wait for:** "proceed", "yes", "go ahead", "approved"

**Do NOT continue until explicit approval received.**

---

## Phase 2: Research

```
Task(issue-researcher):
  Input:  { issue_number: <N> }
  Output: { plan_path, complexity, commit_count }
```

The issue-researcher will:

- Analyze codebase using Glob, Grep, Read
- Check dependencies
- Create dev plan at `.claude/dev-plans/issue-<N>.md`

---

## GATE 2: Plan Review

**STOP** - Hard gate requiring explicit approval.

**Show to user:**

- Full development plan (every line, no summarizing)
- Planned commit count
- Affected files

**Ask via `telegram` skill** (or terminal):

> Plan ready for Issue #<N>
>
> <commit-count> commits planned
>
> Proceed with implementation? (yes/no)

**Wait for:** "proceed", "yes", "go ahead", "approved"

**Do NOT continue until explicit approval received.**

---

## Phase 3: Implement

The orchestrator handles implementation directly with per-commit gates.

For each commit in the plan:

1. **Make changes** per plan step
2. **Run validation:**
   ```
   bun run type-check
   bun run lint
   ```
3. **Show diff** to user

### GATE 3: Commit Review (per commit)

**STOP** - Hard gate for each commit.

**Show to user:**

- git diff of staged changes
- Proposed commit message

**Ask via `telegram` skill** (or terminal):

> Commit <N>/<total>: <message>
>
> <files-changed> files changed
>
> Approve this commit? (yes/no)

**Wait for:** "proceed", "yes", "approved"

4. **If approved:** Commit changes
5. **If rejected:** Ask for guidance, modify, re-show

---

## Phase 4: Review

**If `--skip-review`:** Skip to Phase 5.

```
Skill(review):
  Input:  { workflow_id }
  Output: { findings, summary }
```

The review skill will:

- Spawn review agents in parallel
- Classify findings by severity
- Auto-fix critical findings
- Return summary

---

## GATE 4: Pre-PR Review

**STOP** - Hard gate requiring explicit approval.

**Show to user:**

- Summary of findings by severity
- Critical issues (if any)
- Recommendation (proceed or fix)

**Ask via `telegram` skill** (or terminal):

> Review complete for Issue #<N>
>
> <finding-count> findings (<critical-count> critical)
>
> Create PR? (yes/no/fix)

**Wait for:**

- "proceed", "yes" → Continue to Phase 5
- "fix" → Address issues, re-run Phase 4
- "no" → Pause, wait for guidance

---

## Phase 5: Finalize

```
Skill(finalize):
  Input:  { issue_number: <N>, findings_summary: <from-phase-4> }
  Output: { pr }
```

The finalize skill will:

- Run final validation
- Clean up dev plan file
- Push branch
- Create PR
- Update board to "Blocked"
- Send notification via `telegram` skill with PR link

---

## Critical Rules

**YOU are the orchestrator. Do not delegate gate handling to agents.**

1. **STOP means STOP** — Literally halt and wait for user input
2. **Gates require explicit approval** — Silence is not approval
3. **One gate at a time** — Don't batch or preview future gates
4. **Show, don't summarize** — Full content at every gate
5. **Evidence, not claims** — "Verified" requires showing output, not describing it
6. **File changes after Gate 2 only** — No modifications before plan approval

### Skipped Gate Recovery

If you realize you skipped a gate:

1. STOP immediately
2. Acknowledge: "I skipped a gate. Let me go back."
3. Return to the missed gate and show the required content
4. Do not continue until gate is passed

---

## Error Handling

| Error              | Behavior                     |
| ------------------ | ---------------------------- |
| Issue not found    | Report error, exit           |
| Existing workflow  | Offer resume or fresh start  |
| Gate timeout       | Wait indefinitely            |
| Validation failure | Show error, ask for guidance |

---

## Success Criteria

Workflow succeeds when:

- All 4 gates passed with explicit approval
- PR is created
- Board updated to "Blocked"
- Workflow marked complete
