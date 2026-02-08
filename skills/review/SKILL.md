---
name: review
description: Coordinates review agents and manages auto-fix loop. Spawns code-reviewer, test-analyzer, silent-failure-hunter in parallel, classifies findings, and attempts fixes for critical issues.
allowed-tools: Bash, Read, Glob, Grep, Skill, Task
---

# Review Skill

Coordinates code review and manages the auto-fix cycle.

## Contract

### Input

| Field                   | Type     | Required | Description                                       |
| ----------------------- | -------- | -------- | ------------------------------------------------- |
| `workflow_id`           | string   | Yes      | Checkpoint workflow ID                            |
| `skip_agents`           | string[] | No       | Agents to skip (default: none)                    |
| `max_retry`             | number   | No       | Max fix attempts per finding (default: 3)         |
| `parallel`              | boolean  | No       | Run agents in parallel (default: true)            |
| `include_ob_compliance` | boolean  | No       | Force OB compliance review (default: auto-detect) |

### Output

| Field                 | Type    | Description                     |
| --------------------- | ------- | ------------------------------- |
| `findings`            | array   | All findings from review agents |
| `findings[].agent`    | string  | Which agent found this          |
| `findings[].severity` | string  | CRITICAL, HIGH, MEDIUM, LOW     |
| `findings[].file`     | string  | File path                       |
| `findings[].line`     | number  | Line number                     |
| `findings[].message`  | string  | Finding description             |
| `findings[].fixed`    | boolean | Whether auto-fix succeeded      |
| `summary.total`       | number  | Total findings                  |
| `summary.critical`    | number  | Critical findings               |
| `summary.fixed`       | number  | Successfully fixed              |
| `summary.unresolved`  | number  | Critical findings not fixed     |

### Side Effects

1. Spawns review agents (parallel or sequential)
2. Spawns auto-fixer for critical findings
3. Creates fix commits
4. Logs all actions to checkpoint

### Checkpoint Actions Logged

- `review_started`: { agents: [] }
- `agent_completed`: { agent, findingCount }
- `fix_attempted`: { file, line, attempt, result }
- `review_complete`: { summary }

## Review Agents

| Agent                                     | Purpose                | Critical Threshold                   |
| ----------------------------------------- | ---------------------- | ------------------------------------ |
| `pr-review-toolkit:code-reviewer`         | Code quality, patterns | Confidence >= 91 OR label="Critical" |
| `pr-review-toolkit:pr-test-analyzer`      | Test coverage gaps     | Gap rating >= 8                      |
| `pr-review-toolkit:silent-failure-hunter` | Error handling         | Severity = "CRITICAL"                |
| `openbadges-compliance-reviewer`          | OB spec compliance     | "MUST violation"                     |

## Workflow

### Step 1: Detect Scope

**Get changed files:**

```bash
git diff main --name-only
```

**Detect if badge code (auto-enable OB compliance):**
Check if any files match:

- `**/badge*`, `**/credential*`, `**/issuer*`, `**/assertion*`
- `**/ob2/**`, `**/ob3/**`, `**/openbadges/**`

```bash
git diff main --name-only | grep -iE "(badge|credential|issuer|assertion|ob2|ob3|openbadges)"
```

If matches found and `include_ob_compliance` not explicitly false → enable OB compliance review.

### Step 2: Spawn Review Agents

**If parallel mode (default):**

Spawn all agents simultaneously using Task tool with multiple calls:

```text
Task(pr-review-toolkit:code-reviewer): "Review code changes for issue workflow <workflow_id>"
Task(pr-review-toolkit:pr-test-analyzer): "Analyze test coverage for changes"
Task(pr-review-toolkit:silent-failure-hunter): "Check for silent failures in changes"
Task(openbadges-compliance-reviewer): "Check OB spec compliance" (if badge code)
```

**If sequential mode:**

Spawn each agent one at a time, collecting results.

### Step 3: Collect and Normalize Findings

Each agent returns findings in different formats. Normalize to:

```json
{
  "agent": "<agent-name>",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "file": "<file-path>",
  "line": <line-number>,
  "message": "<description>",
  "fixed": false
}
```

**Classification rules:**

| Agent                  | CRITICAL if                          | HIGH if            | MEDIUM/LOW otherwise    |
| ---------------------- | ------------------------------------ | ------------------ | ----------------------- |
| code-reviewer          | Confidence >= 91 OR label="Critical" | Confidence >= 75   | Confidence < 75         |
| silent-failure-hunter  | Severity="CRITICAL"                  | Severity="HIGH"    | Severity="MEDIUM"/"LOW" |
| pr-test-analyzer       | Gap rating >= 8                      | Gap rating >= 5    | Gap rating < 5          |
| ob-compliance-reviewer | "MUST violation"                     | "SHOULD violation" | "MAY" / warnings        |

### Step 4: Auto-Fix Loop

**For each CRITICAL finding:**

```text
attempt = 0
while not fixed AND attempt < max_retry:
    attempt++

    Spawn auto-fixer:
    Task(auto-fixer): "Fix: <finding.message> in <finding.file>:<finding.line>"

    If fix successful:
        finding.fixed = true
    Else:
        Continue to next attempt
```

### Step 5: Re-Review After Fixes

If any fixes were made:

1. Run validation:

   ```bash
   bun run type-check
   ```

   ```bash
   bun run lint
   ```

2. If validation fails, revert last fix:

   ```bash
   git checkout -- <file>
   ```

   Mark finding as not fixed.

3. Optionally re-run review agents to verify fixes (if time permits).

### Step 6: Calculate Summary

```json
{
  "total": <all-findings>,
  "critical": <critical-count>,
  "fixed": <successfully-fixed>,
  "unresolved": <critical-not-fixed>
}
```

### Step 7: Return Output

```json
{
  "findings": [...],
  "summary": {
    "total": <n>,
    "critical": <n>,
    "fixed": <n>,
    "unresolved": <n>
  }
}
```

## Error Handling

| Condition            | Behavior                            |
| -------------------- | ----------------------------------- |
| Agent fails to spawn | Log error, continue with others     |
| All agents fail      | Return error (critical)             |
| Fix validation fails | Revert fix, try next approach       |
| Max retry exceeded   | Mark as unresolved, continue        |
| Timeout              | Return partial results with warning |

## Output Format

```text
REVIEW COMPLETE

Agents Run: code-reviewer, test-analyzer, silent-failure-hunter
Findings: <total> total (<critical> critical)
Fixed: <fixed>/<critical> critical issues

UNRESOLVED (require manual attention):
1. [code-reviewer] src/foo.ts:42 - Missing null check
2. [silent-failure-hunter] src/bar.ts:89 - Silent catch block

NON-CRITICAL (for PR reviewer):
- [code-reviewer] src/baz.ts:15 - Consider extracting helper (confidence: 72)
- [test-analyzer] Missing edge case test for empty input (gap: 4)

Summary: <unresolved> unresolved critical findings
```

## Escalation Trigger

If `summary.unresolved > 0`:

The calling workflow should escalate to user with:

- List of unresolved findings
- Options: continue (manual fix), force-pr, abort

## Success Criteria

This skill is successful when:

- All review agents run (or gracefully skip on failure)
- Findings are correctly classified by severity
- Auto-fix attempted for all CRITICAL findings
- Clear summary returned to orchestrator
- Escalation triggered when appropriate
