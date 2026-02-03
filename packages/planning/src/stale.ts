/**
 * Stale Item Detection
 *
 * Detects planning stack items that may be stale based on git/GitHub activity.
 * Adapted from claude-knowledge/src/planning/stale.ts.
 */

import { spawnSync } from "bun";
import type {
  Goal,
  PlanningEntity,
  PlanStep,
  StaleItem,
  CompletionStatus,
} from "./types";
import type { PlanningManager } from "./manager";
import type { ResolverFactory } from "./resolvers";

/** Cache for GitHub issue state checks (5-minute TTL) */
const issueStateCache = new Map<
  number,
  { state: string; closedAt: string | null; fetchedAt: number }
>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_INACTIVITY_DAYS = 7; // Days of inactivity before flagging as stale

/**
 * Check if a GitHub issue is closed (with caching).
 */
function checkIssueClosed(
  issueNumber: number
): { closed: boolean; closedAt: string | null } | null {
  // Check cache first
  const cached = issueStateCache.get(issueNumber);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      closed: cached.state === "CLOSED",
      closedAt: cached.closedAt,
    };
  }

  try {
    const result = spawnSync([
      "gh",
      "issue",
      "view",
      String(issueNumber),
      "--json",
      "state,closedAt",
    ]);

    if (result.success) {
      const data = JSON.parse(result.stdout.toString()) as {
        state: string;
        closedAt: string | null;
      };

      // Update cache
      issueStateCache.set(issueNumber, {
        state: data.state,
        closedAt: data.closedAt,
        fetchedAt: Date.now(),
      });

      return {
        closed: data.state === "CLOSED",
        closedAt: data.closedAt,
      };
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Format a relative time string (e.g., "2 days ago").
 */
function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor(diff / (60 * 60 * 1000));

  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "recently";
}

/**
 * Detect stale items on the planning stack.
 *
 * An item is considered stale if:
 * - It's a Goal with a linked issue that has been closed (via issueNumber)
 * - It's a Goal with a linked plan step whose external ref is complete (via planStepId)
 * - It's been on the stack with no activity for an extended period
 */
export async function detectStaleItems(
  manager: PlanningManager,
  resolverFactory: ResolverFactory
): Promise<StaleItem[]> {
  const stack = manager.peekStack();
  const staleItems: StaleItem[] = [];

  for (const item of stack.items) {
    // Check Goals with linked issues
    if (item.type === "Goal") {
      const goal = item as Goal;

      // Check plan-managed goals (via planStepId)
      if (goal.planStepId) {
        try {
          const step = manager.getStep(goal.planStepId);
          if (step) {
            const resolver = resolverFactory.getResolver(step.externalRef.type);
            const status: CompletionStatus = await resolver.resolve(step);

            if (status === "done") {
              // Extract issue number if external ref is an issue
              const issueNumber =
                step.externalRef.type === "issue"
                  ? step.externalRef.number
                  : undefined;

              const reason = issueNumber
                ? `Linked issue #${issueNumber} closed - auto-pop?`
                : `Linked ${step.externalRef.type} complete - auto-pop?`;

              staleItems.push({
                item,
                staleSince: new Date().toISOString(),
                reason,
              });
              continue;
            }
          }
        } catch (error) {
          // Resolver failed - skip this goal but log for diagnostics
          // Using console.debug to avoid noise in normal operation
          console.debug?.(`[stale] Failed to resolve step ${goal.planStepId}:`, error);
        }
      }

      // Check goals with direct issue links (legacy pattern)
      if (goal.issueNumber) {
        const issueState = checkIssueClosed(goal.issueNumber);
        if (issueState?.closed) {
          staleItems.push({
            item,
            staleSince: issueState.closedAt || new Date().toISOString(),
            reason: `Issue #${goal.issueNumber} closed ${issueState.closedAt ? formatRelativeTime(issueState.closedAt) : ""}. Run planning-done to summarize.`,
          });
          continue;
        }
      }
    }

    // Check for items with no recent activity
    const ageMs = Date.now() - new Date(item.updatedAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);

    if (ageDays > STALE_INACTIVITY_DAYS && item.status === "paused") {
      staleItems.push({
        item,
        staleSince: item.updatedAt,
        reason: `No activity for ${Math.floor(ageDays)} days while paused.`,
      });
    }
  }

  return staleItems;
}

/**
 * Clear the issue state cache (useful for testing).
 */
export function clearStaleCache(): void {
  issueStateCache.clear();
}
