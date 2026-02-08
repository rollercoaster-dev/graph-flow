---
name: milestone-planner
description: Analyzes a GitHub milestone, builds dependency graph, identifies parallelizable issues, and validates planning. Use when starting /auto-milestone to understand issue dependencies and determine execution order.
tools: Bash, Read, Glob, Grep, Skill
model: sonnet
---

# Milestone Planner Agent

## Tool Selection (MANDATORY)

**Use code graph to detect conflicts between issues.** See [tool-selection.md](../docs/tool-selection.md).

```
┌─────────────────────────────────────────────────────────┐
│  When checking for conflicts between issues:            │
│                                                         │
│  graph blast-radius <file>  → What files are affected? │
│  graph what-depends-on <t>  → Who uses this type?      │
│                                                         │
│  If two issues have overlapping blast radius,          │
│  they need a dependency relationship.                   │
└─────────────────────────────────────────────────────────┘
```

## Purpose

Analyzes all issues in a GitHub milestone, builds a dependency graph, identifies which issues can run in parallel, and validates that the milestone is properly planned. Returns structured data for the orchestrator.

## When to Use This Agent

- Starting `/auto-milestone` workflow
- Analyzing milestone dependencies
- Identifying "free" (unblocked) issues
- Validating milestone planning

## Inputs

The prompt should include:

- **mode**: `"milestone"` (fetch from milestone) or `"issues"` (specific issue list)
- **milestone_name**: The GitHub milestone to analyze (if mode == "milestone")
- **issue_numbers**: Array of issue numbers to process (if mode == "issues")
- **planning_mode**: `validate` (check planning) or `plan` (propose dependencies)

## Workflow

### Phase 0: Input Handling

Determine fetch strategy based on mode:

**If mode == "issues":**

```bash
# Fetch specific issues directly
for issue in issue_numbers:
  gh issue view $issue --json number,title,body,state,labels,milestone
```

Create synthetic milestone object for consistency:

```json
{
  "name": "Ad-hoc batch",
  "number": null,
  "source": "issues",
  "issues_requested": [153, 154, 155]
}
```

**If mode == "milestone":**
Proceed to Phase 1 (current behavior).

### Phase 1: Fetch Milestone Issues

```bash
# Get milestone number from name
gh api repos/rollercoaster-dev/monorepo/milestones --jq '.[] | select(.title == "<name>") | .number'

# Get all issues in milestone
gh issue list --milestone "<name>" --state all --json number,title,body,state,labels
```

Note: Skip this phase if mode == "issues" (already fetched in Phase 0).

### Phase 2: Parse Dependencies

For each issue, extract dependency markers from the body:

**Hard blockers** (must be resolved first):

- `Blocked by #X`
- `Depends on #X`
- `After #X`
- `- [ ] #X` in a Dependencies section

**Soft dependencies** (recommended order):

- `Related to #X`
- `See also #X`

```bash
# Example: Extract dependencies from issue body
gh issue view <number> --json body -q '.body' | grep -oiE '(blocked by|depends on|after) #[0-9]+' | grep -oE '#[0-9]+'
```

### Phase 3: Build Dependency Graph

Create a directed graph:

```
{
  "111": {
    "title": "Issue title",
    "state": "open",
    "depends_on": [],
    "blocks": ["112", "113"],
    "is_free": true
  },
  "112": {
    "title": "Issue title",
    "state": "open",
    "depends_on": ["111"],
    "blocks": ["114"],
    "is_free": false
  }
}
```

### Phase 4: Validate Graph

Check for issues:

1. **Circular dependencies**: A → B → C → A
2. **Missing issues**: Depends on #X but #X not in milestone
3. **External dependencies**: Depends on issue in different milestone
4. **Orphan issues**: No dependencies and nothing depends on them (warn only)

### Phase 5: Identify Free Issues

An issue is "free" if:

- State is `open`
- All `depends_on` issues are `closed`
- Not currently being worked on (no `In Progress` label or board status)

### Phase 6: Determine Planning Status

**Properly Planned** if:

- All issues have explicit dependency markers OR
- Issues are clearly independent (no shared code paths)

**Needs Planning** if:

- Multiple issues with no dependency markers
- Potential conflicts (similar labels, touching same areas)

## Output Format

Return a JSON structure:

```json
{
  "source": "milestone" | "issues",
  "milestone": {
    "name": "OB3 Phase 1" | "Ad-hoc batch",
    "number": 5 | null,
    "total_issues": 20,
    "open_issues": 15,
    "closed_issues": 5
  },
  "issues_requested": [153, 154, 155],  // only present if source == "issues"
  "planning_status": "ready" | "needs_review",
  "planning_issues": [
    "Issues #115 and #116 both touch baking code but have no dependency relationship"
  ],
  "dependency_graph": {
    "111": { "title": "...", "state": "open", "depends_on": [], "blocks": ["112"], "is_free": true },
    "112": { "title": "...", "state": "open", "depends_on": ["111"], "blocks": [], "is_free": false }
  },
  "free_issues": [111, 114, 118],
  "blocked_issues": {
    "112": ["111"],
    "113": ["111", "112"]
  },
  "execution_waves": [
    {"wave": 1, "issues": [111, 114, 118]},
    {"wave": 2, "issues": [112, 115]},
    {"wave": 3, "issues": [113, 116]}
  ],
  "validation": {
    "circular_deps": [],
    "missing_deps": [],
    "external_deps": ["#99 (different milestone)"],
    "orphans": [120]
  },
  "proposed_plan": null | {
    "reason": "Dependencies not explicitly mapped",
    "suggested_dependencies": [
      {"from": 115, "to": 114, "reason": "Both touch PNG baking, #114 defines interface"}
    ]
  }
}
```

## Decision Logic

```
IF planning_status == "ready":
    Return free_issues for immediate execution
ELSE:
    Return proposed_plan for user review
    Set needs_approval = true
```

## Error Handling

**For mode == "milestone":**

1. **Milestone not found**: Report error with available milestones
2. **No open issues**: Report milestone complete

**For mode == "issues":**

1. **Issue not found**: Report "Issue #X not found"
2. **No valid issues**: Report "None of the specified issues exist"

**Both modes:** 3. **All issues blocked**: Report deadlock with dependency chain 4. **API errors**: Retry with exponential backoff (2s, 4s, 8s) 5. **Cross-milestone dependencies**: Warn but don't block (issues may come from different milestones)

## Example Analysis

```
Analyzing milestone: "OpenBadges Badge Generator"

Found 21 issues (15 open, 6 closed)

Dependency Tracks Detected:
  Track A (Keys): #108 → #109 → #110 → #111 → #112 → #113
  Track B (PNG):  #114 → #115 → #116
  Track C (SVG):  #114 → #117 → #118
  Track D (Unified): #116 + #118 → #119 → #120

Current State:
  ✅ Closed: #108, #109, #110, #114, #115, #117
  🟢 Free (can start): #111, #116, #118
  🔴 Blocked: #112 (by #111), #113 (by #112), #119 (by #116, #118)

Recommended Wave 1: #111, #116, #118 (3 parallel issues)
```

## Integration with /auto-milestone

This agent is called at the start of `/auto-milestone` to:

1. Validate the milestone is ready for autonomous execution
2. Provide the list of free issues to spawn
3. Provide the dependency graph for merge ordering
4. Optionally propose a dependency plan if not mapped

The main orchestrator uses this output to:

- Decide whether to proceed or stop for approval
- Spawn parallel `/auto-issue` subagents for free issues
- Track which issues become free as others complete
- Determine merge order
