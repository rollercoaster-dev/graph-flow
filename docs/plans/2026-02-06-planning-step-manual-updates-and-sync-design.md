# Planning Step Manual Updates and GitHub Sync

**Date:** 2026-02-06
**Status:** Design Complete
**Author:** Claude (with user input)

## Problem Statement

The graph-flow planning system has two key gaps:

1. **No manual step update tool** - Users cannot manually mark plan steps as done/in-progress/not-started. The only way to update step status is through external sources (GitHub issues or manual completion markers).

2. **No explicit GitHub sync** - While the system polls GitHub on-demand (with 5-min cache), there's no way to force-refresh all steps from GitHub to capture work done during tangents or context switches.

**User context:** ADHD workflow with frequent tangents. Need minimal friction for tracking progress and automatic capture of work done outside the plan.

## Goals

1. Add `planning-step-update` tool for manual status overrides
2. Add `planning-sync` tool for bulk GitHub refresh
3. Make tracking as automated and low-friction as possible
4. Maintain compatibility with existing resolver architecture

## Non-Goals

- Background polling or webhooks (too complex)
- Bidirectional sync (pushing changes back to GitHub)
- Real-time updates (on-demand is sufficient)

## Design Overview

### Architecture Principles

1. **Manual overrides are durable** - Persist until explicitly changed or cleared
2. **GitHub is default source** - If no manual override, use GitHub state
3. **Explicit sync** - No background processes, user triggers refresh when needed
4. **Resolver precedence** - Manual status → Cache → External source

### How It Works

Currently, step status is computed on-demand:
```
planning-progress → resolvers check status → 5-min cache → return progress
```

With this design:
```
planning-progress → check manual override → check cache → check GitHub → return progress
planning-step-update → set manual override → clear cache → persist
planning-sync → clear cache → fetch all from GitHub → report changes
```

## New Tools

### Tool 1: `planning-step-update`

**Purpose:** Manually set step status, overriding external sources.

**Parameters:**
- `stepId` (string, required): The step ID to update
- `status` (string, required): One of "done", "in-progress", "not-started"
- `clearOverride` (boolean, optional): If true, remove manual override and revert to external source

**Behavior:**

```bash
# Mark step as done
planning-step-update --stepId step-123 --status done
→ Stores {"stepId":"step-123","status":"done","updatedAt":"..."} to manual-status.jsonl
→ Clears cache for this step
→ Returns updated step with new status

# Mark step as in-progress
planning-step-update --stepId step-456 --status in-progress
→ Useful when actively working on something

# Clear manual override (revert to GitHub)
planning-step-update --stepId step-123 --clearOverride true
→ Removes manual status entry
→ Step status reverts to GitHub/external source
→ Clears cache
```

**Response format:**
```json
{
  "step": {
    "id": "step-123",
    "title": "Implement authentication",
    "status": "done",
    "manualOverride": true,
    "updatedAt": "2026-02-06T10:30:00Z"
  }
}
```

### Tool 2: `planning-sync`

**Purpose:** Force-refresh all issue-type steps from GitHub.

**Parameters:**
- `planId` (string, optional): Sync specific plan
- `goalId` (string, optional): Alternative to planId, sync plan for this goal
- If both omitted, syncs all plans on the stack

**Behavior:**

```bash
# Sync all plans
planning-sync
→ Gets all active/paused goals with plans
→ Clears cache for all issue-type steps
→ Fetches fresh GitHub state via `gh issue view`
→ Returns summary of changes

# Sync specific plan
planning-sync --planId plan-123
→ Same but only for specified plan

# Sync by goal
planning-sync --goalId goal-456
→ Finds plan for goal, then syncs
```

**Response format:**
```json
{
  "synced": 15,
  "updated": [
    {
      "stepId": "step-123",
      "title": "Fix login bug",
      "issue": 42,
      "oldStatus": "in-progress",
      "newStatus": "done"
    },
    {
      "stepId": "step-456",
      "title": "Add OAuth",
      "issue": 43,
      "oldStatus": "not-started",
      "newStatus": "in-progress"
    }
  ],
  "unchanged": 12,
  "errors": [
    {
      "stepId": "step-789",
      "issue": 99,
      "error": "Issue not found"
    }
  ]
}
```

## Data Model Changes

### New Storage File

**Location:** `~/.graph-flow/planning/manual-status.jsonl`

**Schema:**
```typescript
interface ManualStatus {
  stepId: string;
  status: CompletionStatus; // "done" | "in-progress" | "not-started"
  updatedAt: string; // ISO 8601 timestamp
}
```

**Example content:**
```jsonl
{"stepId":"step-123","status":"done","updatedAt":"2026-02-06T10:30:00Z"}
{"stepId":"step-456","status":"in-progress","updatedAt":"2026-02-06T11:00:00Z"}
{"stepId":"step-789","status":"not-started","updatedAt":"2026-02-06T11:15:00Z"}
```

### Storage Operations

Add to `PlanningStorage`:

```typescript
class PlanningStorage {
  private manualStatus: Map<string, ManualStatus>;
  private manualStatusFile: string;

  // Set or update manual status for a step
  setManualStatus(stepId: string, status: CompletionStatus): void {
    this.manualStatus.set(stepId, {
      stepId,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  // Get manual status for a step (returns null if no override)
  getManualStatus(stepId: string): CompletionStatus | null {
    return this.manualStatus.get(stepId)?.status ?? null;
  }

  // Clear manual override for a step
  clearManualStatus(stepId: string): void {
    this.manualStatus.delete(stepId);
  }

  // Get all manual statuses (for sync summary)
  getAllManualStatuses(): ManualStatus[] {
    return Array.from(this.manualStatus.values());
  }

  // Persist manual statuses to disk
  async persistManualStatuses(): Promise<void> {
    // Write Map to JSONL file (same pattern as existing storage)
  }
}
```

## Resolver Changes

### Updated Resolution Logic

Both `IssueResolver` and `ManualResolver` need to check manual status first:

```typescript
class IssueResolver implements CompletionResolver {
  constructor(private storage: PlanningStorage) {}

  async resolve(step: PlanStep): Promise<CompletionStatus> {
    // 1. Check manual override (highest priority)
    const manualStatus = this.storage.getManualStatus(step.id);
    if (manualStatus !== null) {
      return manualStatus;
    }

    // 2. Check cache
    const cached = getCachedStatus(step.id, `issue:${step.externalRef.number}`);
    if (cached) {
      return cached;
    }

    // 3. Fetch from GitHub
    const issueState = checkIssueState(step.externalRef.number);
    if (!issueState) {
      return "not-started";
    }

    let status: CompletionStatus;
    if (issueState.state === "CLOSED") {
      status = "done";
    } else if (issueState.linkedPRNumber) {
      status = "in-progress";
    } else {
      status = "not-started";
    }

    setCachedStatus(step.id, `issue:${step.externalRef.number}`, status);
    return status;
  }
}

class ManualResolver implements CompletionResolver {
  constructor(private storage: PlanningStorage) {}

  async resolve(step: PlanStep): Promise<CompletionStatus> {
    // 1. Check manual override (highest priority)
    const manualStatus = this.storage.getManualStatus(step.id);
    if (manualStatus !== null) {
      return manualStatus;
    }

    // 2. Check cache
    const cached = getCachedStatus(step.id, "manual");
    if (cached) {
      return cached;
    }

    // 3. Check manual completion marker (legacy)
    const status: CompletionStatus = this.storage.isManuallyCompleted(step.id)
      ? "done"
      : "not-started";

    setCachedStatus(step.id, "manual", status);
    return status;
  }
}
```

**Key change:** Manual status overrides checked BEFORE cache and external sources.

### Resolver Factory Updates

```typescript
class ResolverFactory {
  private issueResolver: IssueResolver;
  private manualResolver: ManualResolver;

  constructor(storage: PlanningStorage) {
    // Pass storage to resolvers so they can check manual overrides
    this.issueResolver = new IssueResolver(storage);
    this.manualResolver = new ManualResolver(storage);
  }

  getResolver(refType: ExternalRefType): CompletionResolver {
    switch (refType) {
      case "issue":
        return this.issueResolver;
      case "manual":
        return this.manualResolver;
      default:
        return this.manualResolver;
    }
  }
}
```

## Manager Changes

Add to `PlanningManager`:

```typescript
class PlanningManager {
  /**
   * Set manual status override for a step.
   */
  async setStepStatus(stepId: string, status: CompletionStatus): Promise<void> {
    // Verify step exists
    const step = this.storage.getStep(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    // Set manual status
    this.storage.setManualStatus(stepId, status);
    await this.storage.persistManualStatuses();

    // Clear cache so next progress check uses new status
    clearStatusCache();
  }

  /**
   * Clear manual status override for a step.
   */
  async clearStepStatus(stepId: string): Promise<void> {
    this.storage.clearManualStatus(stepId);
    await this.storage.persistManualStatuses();

    // Clear cache so next progress check uses external source
    clearStatusCache();
  }

  /**
   * Sync all issue-type steps from GitHub.
   * Clears cache and fetches fresh state for each step.
   */
  async syncFromGitHub(planId?: string): Promise<{
    synced: number;
    updated: Array<{ stepId: string; title: string; issue: number; oldStatus: CompletionStatus; newStatus: CompletionStatus }>;
    unchanged: number;
    errors: Array<{ stepId: string; issue: number; error: string }>;
  }> {
    // Get plans to sync
    const plans = planId
      ? [this.storage.getPlan(planId)].filter(Boolean)
      : this.getAllPlans();

    const results = {
      synced: 0,
      updated: [],
      unchanged: 0,
      errors: [],
    };

    // For each plan, get steps and sync issue-type steps
    for (const plan of plans) {
      const steps = this.storage.getStepsByPlan(plan.id);

      for (const step of steps) {
        if (step.externalRef.type !== "issue") continue;

        results.synced++;

        // Get old status (check cache first)
        const oldStatus = await this.resolverFactory.getResolver("issue").resolve(step);

        // Clear cache to force fresh fetch
        clearStatusCache();

        // Get new status (will fetch from GitHub)
        const newStatus = await this.resolverFactory.getResolver("issue").resolve(step);

        if (oldStatus !== newStatus) {
          results.updated.push({
            stepId: step.id,
            title: step.title,
            issue: step.externalRef.number!,
            oldStatus,
            newStatus,
          });
        } else {
          results.unchanged++;
        }
      }
    }

    return results;
  }
}
```

## Implementation Details

### Files to Modify

1. **`packages/planning/src/types.ts`**
   - Add `ManualStatus` interface

2. **`packages/planning/src/storage.ts`**
   - Add `manualStatus` Map
   - Add `manualStatusFile` path
   - Add `setManualStatus()`, `getManualStatus()`, `clearManualStatus()`, `getAllManualStatuses()`
   - Add `persistManualStatuses()` method
   - Load manual statuses in `init()`

3. **`packages/planning/src/resolvers.ts`**
   - Update `IssueResolver` constructor to accept `storage`
   - Update `IssueResolver.resolve()` to check manual status first
   - Update `ManualResolver.resolve()` to check manual status first
   - Update `ResolverFactory` to pass storage to resolvers

4. **`packages/planning/src/manager.ts`**
   - Add `setStepStatus(stepId, status)` method
   - Add `clearStepStatus(stepId)` method
   - Add `syncFromGitHub(planId?)` method

5. **`packages/planning/src/mcp-tools.ts`**
   - Add `planning-step-update` tool definition
   - Add `planning-sync` tool definition
   - Add `handleStepUpdate()` handler
   - Add `handleSync()` handler

### Testing Strategy

**Unit tests:**
- Manual status CRUD operations
- Resolver precedence (manual > cache > external)
- Cache invalidation after updates

**Integration tests:**
- End-to-end step update flow
- End-to-end sync flow
- Tool definitions and handlers

**Manual testing:**
- Create plan with issue-type steps
- Mark step manually via `planning-step-update`
- Verify progress reflects manual status
- Close GitHub issue
- Run `planning-sync` to capture change
- Verify progress reflects GitHub state for non-overridden steps

## Migration & Compatibility

### Backward Compatibility

- Existing plans and steps work unchanged
- Existing `isManuallyCompleted()` markers continue to work
- Manual status is optional - if not set, falls back to external source

### Migration Path

No migration needed. The new manual-status.jsonl file is created on first use.

### Deprecation

Consider deprecating `setManuallyCompleted()` in favor of `setStepStatus(stepId, "done")` for consistency. Keep the old method for backward compatibility but document the new approach.

## User Workflow Examples

### Example 1: Manual Override During Tangent

```bash
# You're working on issue #42 but realize it's done even though issue is still open
planning-step-update --stepId step-123 --status done

# Check progress - step shows as done
planning-progress --goalId goal-456
```

### Example 2: Sync After GitHub Work

```bash
# You closed 3 issues on GitHub during a tangent
# Now sync to capture that work
planning-sync

# Output shows:
# {
#   "synced": 10,
#   "updated": [
#     { "stepId": "step-123", "issue": 42, "oldStatus": "in-progress", "newStatus": "done" },
#     { "stepId": "step-456", "issue": 43, "oldStatus": "not-started", "newStatus": "done" },
#     { "stepId": "step-789", "issue": 44, "oldStatus": "in-progress", "newStatus": "done" }
#   ],
#   "unchanged": 7
# }
```

### Example 3: Clear Override

```bash
# You manually marked something as done, but it was premature
# Clear the override to revert to GitHub state
planning-step-update --stepId step-123 --clearOverride true

# Now GitHub issue state takes over again
```

## Future Enhancements

**Not in this design, but possible later:**

1. **Auto-sync on progress check** - Add flag to `planning-progress` to sync before computing progress
2. **Webhook integration** - Real-time updates from GitHub webhooks
3. **Bidirectional sync** - Push manual updates back to GitHub (close issues, add labels, etc.)
4. **Smart tangent detection** - Detect commits/branches outside the plan and suggest updating steps
5. **Bulk update** - Update multiple steps at once
6. **Status history** - Track when steps changed status and why

## Open Questions

None - design is ready for implementation.

## Approval

Design reviewed and approved by user on 2026-02-06.

Ready to implement.
