/**
 * Plan Progress Computation
 *
 * Computes progress metrics for a plan by resolving step completion status.
 * Adapted from claude-knowledge/src/planning/progress.ts.
 */

import type { ResolverFactory } from "./resolvers";
import type {
  CompletionStatus,
  NextStep,
  Plan,
  PlanProgress,
  PlanStep,
} from "./types";

/**
 * Compute plan progress by resolving step completion status.
 *
 * @param _plan - The plan (reserved for future plan-level metadata)
 * @param steps - The plan's steps
 * @param resolverFactory - Factory to get appropriate resolvers
 * @returns Promise resolving to progress metrics
 */
export async function computePlanProgress(
  _plan: Plan,
  steps: PlanStep[],
  resolverFactory: ResolverFactory,
): Promise<PlanProgress> {
  // Handle empty plan
  if (steps.length === 0) {
    return {
      total: 0,
      done: 0,
      inProgress: 0,
      notStarted: 0,
      blocked: 0,
      percentage: 0,
      currentWave: null,
      nextSteps: [],
    };
  }

  // Resolve all step statuses
  const statusMap = new Map<string, CompletionStatus>();
  for (const step of steps) {
    try {
      const resolver = resolverFactory.getResolver(step.externalRef.type);
      const status = await resolver.resolve(step);
      statusMap.set(step.id, status);
    } catch {
      // Default to not-started on error
      statusMap.set(step.id, "not-started");
    }
  }

  // Compute current wave (lowest wave number with non-done steps)
  const nonDoneWaves = steps
    .filter((s) => statusMap.get(s.id) !== "done")
    .map((s) => s.wave);
  const currentWave =
    nonDoneWaves.length > 0
      ? nonDoneWaves.reduce((a, b) => (a < b ? a : b))
      : null;

  // Build blocked set and next steps in one pass
  const blockedStepIds = new Set<string>();
  const nextSteps: NextStep[] = [];

  for (const step of steps) {
    const status = statusMap.get(step.id);
    if (!status) continue;
    if (status === "done") continue;

    // Check if dependencies are met
    const blockedBy = step.dependsOn.filter((depId) => {
      const depStatus = statusMap.get(depId);
      return !depStatus || depStatus !== "done";
    });

    if (blockedBy.length > 0) {
      blockedStepIds.add(step.id);
      continue;
    }

    // If in current wave, it's a next step
    if (step.wave === currentWave) {
      nextSteps.push({
        step,
        status,
        blockedBy,
        wave: step.wave,
      });
    }
  }

  // Count statuses (after we know which steps are blocked)
  let done = 0;
  let inProgress = 0;
  let notStarted = 0;
  let blocked = 0;

  for (const step of steps) {
    const status = statusMap.get(step.id);
    if (!status) continue;

    if (status === "done") {
      done++;
    } else if (status === "in-progress") {
      inProgress++;
    } else if (blockedStepIds.has(step.id)) {
      blocked++;
    } else {
      notStarted++;
    }
  }

  const percentage =
    steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;

  return {
    total: steps.length,
    done,
    inProgress,
    notStarted,
    blocked,
    percentage,
    currentWave,
    nextSteps: nextSteps.slice(0, 3), // Limit to top 3
  };
}
