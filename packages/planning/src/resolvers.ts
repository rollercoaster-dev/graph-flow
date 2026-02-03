/**
 * Completion Resolvers
 *
 * Pluggable resolver system that determines plan step completion status
 * from external sources at query time (never stored).
 *
 * Simplified from claude-knowledge: only issue and manual resolvers.
 */

import { spawnSync } from "bun";
import type { PlanStep, CompletionStatus, ExternalRefType } from "./types";
import type { PlanningStorage } from "./storage";

// ============================================================================
// Completion Cache
// ============================================================================

/** Cache for completion status checks (5-minute TTL) */
const statusCache = new Map<
  string,
  { status: CompletionStatus; fetchedAt: number }
>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached status for a step + external ref combo.
 */
function getCachedStatus(
  stepId: string,
  externalRefKey: string
): CompletionStatus | null {
  const cacheKey = `${stepId}:${externalRefKey}`;
  const cached = statusCache.get(cacheKey);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  return null;
}

/**
 * Set cached status for a step + external ref combo.
 */
function setCachedStatus(
  stepId: string,
  externalRefKey: string,
  status: CompletionStatus
): void {
  const cacheKey = `${stepId}:${externalRefKey}`;
  statusCache.set(cacheKey, { status, fetchedAt: Date.now() });
}

/**
 * Clear the status cache (useful for testing).
 */
export function clearStatusCache(): void {
  statusCache.clear();
}

// ============================================================================
// Resolver Interface
// ============================================================================

/**
 * Pluggable resolver interface for determining step completion.
 */
export interface CompletionResolver {
  resolve(step: PlanStep): Promise<CompletionStatus>;
}

// ============================================================================
// Issue Resolver
// ============================================================================

/**
 * GitHub issue state from `gh issue view`.
 */
interface GitHubIssueState {
  state: "OPEN" | "CLOSED";
  linkedPRNumber?: number;
}

/**
 * Check GitHub issue state via `gh` CLI.
 */
function checkIssueState(issueNumber: number): GitHubIssueState | null {
  try {
    const result = spawnSync([
      "gh",
      "issue",
      "view",
      String(issueNumber),
      "--json",
      "state,linkedBranches",
    ]);

    if (result.success) {
      const data = JSON.parse(result.stdout.toString()) as {
        state: "OPEN" | "CLOSED";
        linkedBranches?: Array<{ name: string }>;
      };

      // Check for linked PR (indicates in-progress)
      let linkedPRNumber: number | undefined;
      if (data.linkedBranches && data.linkedBranches.length > 0) {
        const branchName = data.linkedBranches[0].name;
        const prResult = spawnSync([
          "gh",
          "pr",
          "list",
          "--head",
          branchName,
          "--json",
          "number",
          "--limit",
          "1",
        ]);

        if (prResult.success) {
          const prData = JSON.parse(prResult.stdout.toString()) as Array<{
            number: number;
          }>;
          if (prData.length > 0) {
            linkedPRNumber = prData[0].number;
          }
        }
      }

      return {
        state: data.state,
        linkedPRNumber,
      };
    }
  } catch {
    // Ignore errors, return null
  }

  return null;
}

/**
 * Issue resolver implementation.
 * Checks GitHub issue state to determine completion status.
 */
export class IssueResolver implements CompletionResolver {
  async resolve(step: PlanStep): Promise<CompletionStatus> {
    // Only handle issue-type external refs
    if (step.externalRef.type !== "issue" || !step.externalRef.number) {
      return "not-started";
    }

    const issueNumber = step.externalRef.number;
    const externalRefKey = `issue:${issueNumber}`;

    // Check cache first
    const cached = getCachedStatus(step.id, externalRefKey);
    if (cached) {
      return cached;
    }

    // Fetch from GitHub
    const issueState = checkIssueState(issueNumber);
    if (!issueState) {
      return "not-started";
    }

    // Map GitHub state to completion status
    let status: CompletionStatus;
    if (issueState.state === "CLOSED") {
      status = "done";
    } else if (issueState.linkedPRNumber) {
      status = "in-progress";
    } else {
      status = "not-started";
    }

    // Cache the result
    setCachedStatus(step.id, externalRefKey, status);

    return status;
  }
}

// ============================================================================
// Manual Resolver
// ============================================================================

/**
 * Manual resolver implementation.
 * Checks local storage for manual completion markers.
 */
export class ManualResolver implements CompletionResolver {
  private storage: PlanningStorage;

  constructor(storage: PlanningStorage) {
    this.storage = storage;
  }

  async resolve(step: PlanStep): Promise<CompletionStatus> {
    // Only handle manual-type external refs
    if (step.externalRef.type !== "manual") {
      return "not-started";
    }

    const externalRefKey = "manual";

    // Check cache first
    const cached = getCachedStatus(step.id, externalRefKey);
    if (cached) {
      return cached;
    }

    // Check if manually marked as completed
    const status: CompletionStatus = this.storage.isManuallyCompleted(step.id)
      ? "done"
      : "not-started";

    // Cache the result
    setCachedStatus(step.id, externalRefKey, status);

    return status;
  }
}

// ============================================================================
// Resolver Factory
// ============================================================================

/**
 * Resolver factory that creates resolvers based on external ref type.
 */
export class ResolverFactory {
  private issueResolver: IssueResolver;
  private manualResolver: ManualResolver;

  constructor(storage: PlanningStorage) {
    this.issueResolver = new IssueResolver();
    this.manualResolver = new ManualResolver(storage);
  }

  /**
   * Get the appropriate resolver for an external reference type.
   */
  getResolver(refType: ExternalRefType): CompletionResolver {
    switch (refType) {
      case "issue":
        return this.issueResolver;
      case "manual":
        return this.manualResolver;
      default:
        return this.manualResolver; // Default to manual
    }
  }
}
