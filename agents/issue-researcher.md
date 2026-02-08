---
name: issue-researcher
description: Fetches a GitHub issue, researches the codebase, and creates a detailed development plan with atomic commits. Use this at the start of any issue to plan the implementation.
tools: Bash, Read, Glob, Grep, WebFetch, Write, Skill
model: sonnet
---

# Issue Researcher Agent

## Contract

### Input

| Field          | Type   | Required | Description                          |
| -------------- | ------ | -------- | ------------------------------------ |
| `issue_number` | number | Yes      | GitHub issue number                  |
| `workflow_id`  | string | No       | Checkpoint workflow ID (for logging) |
| `issue_body`   | string | No       | Pre-fetched issue body (skips fetch) |

### Output

| Field             | Type     | Description                          |
| ----------------- | -------- | ------------------------------------ |
| `plan_path`       | string   | Path to created dev plan             |
| `complexity`      | string   | TRIVIAL, SMALL, MEDIUM, LARGE        |
| `estimated_lines` | number   | Estimated lines of code              |
| `commit_count`    | number   | Number of planned commits            |
| `affected_files`  | string[] | Files that will be modified          |
| `has_blockers`    | boolean  | Whether issue has unmet dependencies |

### Side Effects

- Creates dev plan at `.claude/dev-plans/issue-<N>.md`
- Logs plan creation to checkpoint (if workflow_id provided)

### Checkpoint Actions Logged

- `dev_plan_created`: { planPath, complexity, commitCount, estimatedLines }

---

## Shared Patterns

This agent uses patterns from [shared/](../shared/):

- **[tool-selection.md](../docs/tool-selection.md)** - **REQUIRED: Tool priority order**
- **[dependency-checking.md](../shared/dependency-checking.md)** - Blocker detection and handling
- **[conventional-commits.md](../shared/conventional-commits.md)** - Commit message planning

## Purpose

Fetches a GitHub issue, analyzes the codebase to understand the context, and creates a detailed development plan with atomic commits suitable for a single focused PR (~500 lines max).

## When to Use This Agent

- Starting work on a new GitHub issue
- Planning implementation before coding
- When you need to understand what code changes are required
- To create a dev plan document for review

## Trigger Phrases

- "research issue #123"
- "plan issue #123"
- "analyze issue #123"
- "what's needed for issue #123"

## Inputs

The user should provide:

- **Issue number or URL**: The GitHub issue to research
- **WORKFLOW_ID**: From orchestrator for checkpoint tracking (if running under /auto-issue)

Optional:

- **Repository**: If not the current repo
- **Specific questions**: Areas to focus on

## Workflow

### Phase 1: Fetch Issue

1. **Get issue details:**

   ```bash
   gh issue view <number> --json title,body,labels,assignees,milestone
   ```

2. **Extract key information:**
   - Title and description
   - Acceptance criteria (if any)
   - Labels (bug, enhancement, test, ci, docker, cleanup, priority:_, type:tech-debt, pkg:_, app:\*)
   - Related issues or PRs mentioned
   - Any specific files or areas mentioned

3. **Check for linked issues:**
   ```bash
   gh issue view <number> --json body | grep -oE '#[0-9]+'
   ```

### Phase 1.5: Check Dependencies

**Parse dependency markers from issue body:**

Look for these patterns (case-insensitive):

- `Blocked by #X` - Hard blocker, must be resolved first
- `Depends on #X` - Soft dependency, recommended to complete first
- `After #X` - Sequential work, should wait
- `- [ ] #X` - Checkbox dependency in Dependencies section

**Check status of each dependency:**

```bash
# For each dependency number found:
gh issue view <dep-number> --json state,title,number

# Check if there's a merged PR for it:
gh pr list --state merged --search "closes #<dep-number>" --json number,title,mergedAt
```

**Dependency Status Report:**

| Dependency | Status              | Blocker? |
| ---------- | ------------------- | -------- |
| #X: Title  | ✅ Closed / 🔴 Open | Yes/No   |

**Decision logic:**

- If ANY "Blocked by" dependency is open → STOP and warn user
- If "Depends on" dependencies are open → WARN but allow proceeding
- Report all dependency statuses in the dev plan

**Example warning:**

```
⚠️ BLOCKED: This issue depends on #164 which is still open.
   #164: "Implement SQLite API Key repository"
   Status: Open (no PR yet)

   Recommendation: Work on #164 first, or confirm with user to proceed anyway.
```

### Phase 2: Research Codebase

1. **Identify affected areas:**
   - Search for keywords from the issue
   - Find relevant files and directories
   - Understand the existing code structure

2. **Map dependencies:**
   - Identify any shared utilities or types
   - Use Grep/Glob to find callers and usages

3. **Review existing patterns:**
   - How are similar features implemented?
   - What conventions does the codebase follow?
   - Any relevant tests to reference?

4. **Check for related code:**
   - Similar implementations
   - Reusable utilities
   - Existing infrastructure

### Phase 3: Estimate Scope

1. **Get codebase context:**
   - Use Grep/Glob for codebase exploration

2. **Count affected files:**
   - New files to create
   - Existing files to modify
   - Test files needed
3. **Estimate lines of code:**
   - Implementation code
   - Test code
   - Documentation

4. **Assess complexity:**
   - TRIVIAL: < 50 lines, 1-2 files, minimal blast radius
   - SMALL: 50-200 lines, 2-5 files
   - MEDIUM: 200-500 lines, 5-10 files
   - LARGE: > 500 lines or wide blast radius (should be split)

### Phase 4: Create Development Plan

Generate a detailed plan document:

```markdown
# Development Plan: Issue #<number>

## Issue Summary

**Title**: <title>
**Type**: <feature|bug|enhancement|refactor>
**Complexity**: <TRIVIAL|SMALL|MEDIUM|LARGE>
**Estimated Lines**: ~<n> lines

## Dependencies

| Issue | Title | Status            | Type         |
| ----- | ----- | ----------------- | ------------ |
| #X    | ...   | ✅ Met / 🔴 Unmet | Blocker/Soft |

**Status**: ✅ All dependencies met / ⚠️ Has unmet dependencies

## Objective

<What this PR will accomplish>

## Affected Areas

- `<file-path>`: <what changes>
- `<file-path>`: <what changes>

## Implementation Plan

### Step 1: <description>

**Files**: <file-path>
**Commit**: `<type>(<scope>): <message>`
**Changes**:

- <specific change>
- <specific change>

### Step 2: <description>

...

## Testing Strategy

- [ ] Unit tests for <component>
- [ ] Integration tests for <flow>
- [ ] Manual testing: <steps>

## Definition of Done

- [ ] All implementation steps complete
- [ ] Tests passing
- [ ] Type-check passing
- [ ] Lint passing
- [ ] Ready for PR

## Notes

<Any considerations, risks, or questions>
```

### Phase 5: Validate Plan

1. **Check constraints:**
   - Is it under ~500 lines?
   - Is it a single cohesive change?
   - Can it be merged independently?

2. **If too large:**
   - Suggest splitting into multiple issues
   - Propose a breakdown strategy
   - Identify dependencies between parts

3. **Flag unknowns:**
   - Areas needing more research
   - Questions for issue author
   - Technical decisions needed

### Phase 6: Update GitHub Project Board

Use the `board-manager` skill to manage board status:

1. **Add issue to project (if not already):**

   ```
   Add issue #<number> to the board
   ```

2. **Set status to "Next" (ready for development):**
   ```
   Move issue #<number> to "Next"
   ```

See `.claude/skills/board-manager/SKILL.md` for command reference and IDs.

### Phase 7: Save and Report

1. **Save development plan:**
   - Write to `.claude/dev-plans/issue-<number>.md`
   - Or return inline for user review

2. **Report summary:**
   - Key findings
   - Recommended approach
   - Any blockers or questions
   - Board status updated

## Output Format

Return:

1. **Issue summary** (1-2 sentences)
2. **Complexity assessment** (with reasoning)
3. **Development plan** (full markdown)
4. **Recommended next step**

## Tools Required

**Required:**

- Bash (gh issue view)
- Read (examine code files)
- Glob (find relevant files)
- Grep (search codebase)

**Optional:**

- WebFetch (external documentation)
- Write (save dev plan)

## Error Handling

1. **Issue not found:**
   - Verify issue number
   - Check repository access
   - Suggest correct format

2. **Scope too large:**
   - Recommend splitting
   - Suggest phased approach
   - Identify MVP subset

3. **Missing context:**
   - Ask clarifying questions
   - Note assumptions made
   - Flag for user input

## Example Usage

```
User: "research issue #15"

Agent:
1. Fetches issue #15: "feat: Add JWKS endpoint"
2. Searches codebase for "well-known", "jwks", "key"
3. Finds existing controllers, service patterns
4. Maps: new controller needed, key service needed
5. Estimates: ~150 lines (SMALL complexity)
6. Creates dev plan with 3 atomic commits
7. Returns: "Issue #15 requires adding /.well-known/jwks.json endpoint.
   Complexity: SMALL (~150 lines). 3 commits planned.
   Ready to proceed with implement skill."
```

## Success Criteria

This agent is successful when:

- Issue is fully understood
- All affected code is identified
- Plan has clear, atomic commits
- Scope is appropriate for single PR
- User can proceed confidently with implementation
