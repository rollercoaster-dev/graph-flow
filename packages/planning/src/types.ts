/**
 * Planning Types
 *
 * Type definitions for the planning stack system, adapted from claude-knowledge.
 * Supports goals, interrupts, plans, and steps with external completion tracking.
 */

// ============================================================================
// Planning Entity Types
// ============================================================================

/**
 * Entity types in the planning graph.
 */
export type PlanningEntityType = "Goal" | "Interrupt";

/**
 * Relationship types in the planning graph.
 * - INTERRUPTED_BY: Goal was interrupted by an Interrupt
 * - PAUSED_FOR: Goal was paused for another Goal
 * - COMPLETED_AS: Completed item was summarized as a Learning
 * - PART_OF: Plan -> Goal, PlanStep -> Plan
 * - DEPENDS_ON: PlanStep -> PlanStep
 */
export type PlanningRelationshipType =
  | "INTERRUPTED_BY"
  | "PAUSED_FOR"
  | "COMPLETED_AS"
  | "PART_OF"
  | "DEPENDS_ON";

/**
 * Status of a planning entity on the stack.
 */
export type PlanningEntityStatus = "active" | "paused" | "completed";

/**
 * Base interface for all planning entities.
 */
export interface PlanningEntityBase {
  /** Unique identifier */
  id: string;
  /** Entity type discriminator */
  type: PlanningEntityType;
  /** Short title for display */
  title: string;
  /** Position on the stack (0 = top/most recent) */
  stackOrder: number | null;
  /** Current status */
  status: PlanningEntityStatus;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last updated */
  updatedAt: string;
}

/**
 * A high-level work objective on the planning stack.
 */
export interface Goal extends PlanningEntityBase {
  type: "Goal";
  /** Optional description of the goal */
  description?: string;
  /** Optional linked GitHub issue number */
  issueNumber?: number;
  /** Links to PlanStep when started via plan workflow */
  planStepId?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A context switch that interrupted the current focus.
 */
export interface Interrupt extends PlanningEntityBase {
  type: "Interrupt";
  /** Why this interrupt happened */
  reason: string;
  /** ID of the goal/interrupt that was interrupted */
  interruptedId?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Union type for all planning entities.
 */
export type PlanningEntity = Goal | Interrupt;

/**
 * A relationship between two planning entities.
 */
export interface PlanningRelationship {
  id: string;
  fromId: string;
  toId: string;
  type: PlanningRelationshipType;
  data?: Record<string, unknown>;
  createdAt: string;
}

/**
 * The current state of the planning stack.
 */
export interface PlanningStack {
  /** All active/paused items ordered by stack position (0 = top) */
  items: PlanningEntity[];
  /** Number of items on the stack */
  depth: number;
  /** The topmost item (current focus), if any */
  topItem?: PlanningEntity;
}

/**
 * Summary generated when an item is completed and popped from the stack.
 */
export interface StackCompletionSummary {
  /** The completed item */
  item: PlanningEntity;
  /** Human-readable summary text */
  summary: string;
  /** Duration in milliseconds from creation to completion */
  durationMs: number;
  /** Git artifacts associated with this work (commits, PRs) */
  artifacts?: {
    commitCount?: number;
    prNumber?: number;
    prMerged?: boolean;
    issueClosed?: boolean;
  };
}

/**
 * A stale item detected on the planning stack.
 */
export interface StaleItem {
  /** The stale planning entity */
  item: PlanningEntity;
  /** When the item became stale (ISO timestamp) */
  staleSince: string;
  /** Human-readable reason why it's stale */
  reason: string;
}

// ============================================================================
// Plan and PlanStep Types
// ============================================================================

/**
 * Source type for a plan.
 */
export type PlanSourceType = "milestone" | "epic" | "manual";

/**
 * External reference type for a plan step.
 */
export type ExternalRefType = "issue" | "manual";

/**
 * External reference for a plan step (links to GitHub issue or manual criteria).
 */
export interface ExternalRef {
  type: ExternalRefType;
  number?: number; // GitHub issue number
  criteria?: string; // Manual completion criteria
}

/**
 * A plan is an ordered set of steps toward a Goal.
 * Plans can be created from milestones, epics, or manually.
 */
export interface Plan {
  id: string;
  title: string;
  goalId: string; // PART_OF relationship to Goal
  sourceType: PlanSourceType;
  sourceRef?: string; // milestone number, epic issue number, etc.
  createdAt: string;
  updatedAt: string;
}

/**
 * A plan step is a concrete unit of work within a plan.
 * Step completion is derived from an external source at query time (never stored).
 */
export interface PlanStep {
  id: string;
  planId: string; // PART_OF relationship to Plan
  title: string;
  ordinal: number; // global execution order
  wave: number; // parallelization group
  externalRef: ExternalRef;
  dependsOn: string[]; // PlanStep IDs (DEPENDS_ON relationship)
  createdAt: string;
  updatedAt: string;
}

/**
 * Completion status for a plan step.
 * Resolved from external source at query time.
 */
export type CompletionStatus = "done" | "in-progress" | "not-started";

/**
 * Progress metrics for a plan.
 */
export interface PlanProgress {
  total: number;
  done: number;
  inProgress: number;
  notStarted: number;
  blocked: number;
  percentage: number;
  currentWave: number | null;
  nextSteps: NextStep[];
}

/**
 * A recommended next step with status and dependencies.
 */
export interface NextStep {
  step: PlanStep;
  status: CompletionStatus;
  blockedBy: string[];
  wave: number;
}

/**
 * Enhanced goal status with plan progress.
 */
export interface EnhancedGoalStatus {
  goal: Goal;
  plan: Plan | null;
  progress: PlanProgress | null;
}
