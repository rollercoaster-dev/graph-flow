/**
 * Planning Manager
 *
 * Core logic for managing the planning stack and CRUD operations.
 * Adapted from claude-knowledge/src/planning/stack.ts and store.ts.
 */

import { randomUUID } from "crypto";
import { PlanningStorage } from "./storage";
import { clearStatusCache, ResolverFactory } from "./resolvers";
import type {
  Goal,
  Interrupt,
  PlanningEntity,
  PlanningStack,
  PlanningRelationship,
  Plan,
  PlanStep,
  PlanSourceType,
  ExternalRef,
  CompletionStatus,
} from "./types";

export class PlanningManager {
  private storage: PlanningStorage;
  private resolverFactory!: ResolverFactory;

  constructor(storageDir: string) {
    this.storage = new PlanningStorage({ baseDir: storageDir });
  }

  async init(): Promise<void> {
    await this.storage.init();
    this.resolverFactory = new ResolverFactory(this.storage);
  }

  // ============================================================================
  // Stack Operations
  // ============================================================================

  /**
   * Shift all stack items down by one position and pause the active item.
   * Used when pushing a new goal or interrupt onto the stack.
   */
  private shiftStackDown(now: string): void {
    const stack = this.storage.getStack();
    for (const item of stack) {
      const newStatus = item.status === "active" ? "paused" : item.status;
      const newStackOrder = item.stackOrder !== null ? item.stackOrder + 1 : null;
      this.storage.setEntity({
        ...item,
        status: newStatus,
        stackOrder: newStackOrder,
        updatedAt: now,
      });
    }
  }

  /**
   * Push a new goal onto the planning stack.
   * The current top item (if any) becomes paused.
   */
  async pushGoal(opts: {
    title: string;
    description?: string;
    issueNumber?: number;
    planStepId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ goal: Goal; stack: PlanningStack }> {
    const now = new Date().toISOString();
    const id = `goal-${randomUUID()}`;

    this.shiftStackDown(now);

    // Create new goal at top of stack
    const goal: Goal = {
      id,
      type: "Goal",
      title: opts.title,
      description: opts.description,
      issueNumber: opts.issueNumber,
      planStepId: opts.planStepId,
      metadata: opts.metadata,
      stackOrder: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    this.storage.setEntity(goal);
    await this.storage.persistEntities();

    return { goal, stack: this.peekStack() };
  }

  /**
   * Push a new interrupt onto the planning stack.
   * The current top item (if any) becomes paused and linked via INTERRUPTED_BY.
   */
  async pushInterrupt(opts: {
    title: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    interrupt: Interrupt;
    interruptedItem?: PlanningEntity;
    stack: PlanningStack;
  }> {
    const now = new Date().toISOString();
    const id = `interrupt-${randomUUID()}`;

    // Get current top item before shifting
    const currentTop = this.storage.getStackTop();

    this.shiftStackDown(now);

    // Create new interrupt at top of stack
    const interrupt: Interrupt = {
      id,
      type: "Interrupt",
      title: opts.title,
      reason: opts.reason,
      interruptedId: currentTop?.id,
      metadata: opts.metadata,
      stackOrder: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    this.storage.setEntity(interrupt);
    await this.storage.persistEntities();

    // Create INTERRUPTED_BY relationship if there was a top item
    if (currentTop) {
      const rel: PlanningRelationship = {
        id: `rel-${randomUUID()}`,
        fromId: currentTop.id,
        toId: id,
        type: "INTERRUPTED_BY",
        createdAt: now,
      };
      this.storage.setRelationship(rel);
      await this.storage.persistRelationships();
    }

    return {
      interrupt,
      interruptedItem: currentTop ?? undefined,
      stack: this.peekStack(),
    };
  }

  /**
   * Pop the top item from the stack (mark as completed).
   * Returns the completed item and the item that resumes (if any).
   */
  async popStack(): Promise<{
    completed: PlanningEntity | null;
    resumed: PlanningEntity | null;
    stack: PlanningStack;
  }> {
    const now = new Date().toISOString();
    const top = this.storage.getStackTop();

    if (!top) {
      return { completed: null, resumed: null, stack: this.peekStack() };
    }

    // Mark top item as completed and remove from stack
    this.storage.setEntity({
      ...top,
      status: "completed",
      stackOrder: null,
      updatedAt: now,
    });

    // Promote the next item to active and shift stack orders
    // Note: getStack() filters by status, but we check top.id defensively
    // in case the in-memory state hasn't fully propagated
    const stack = this.storage.getStack();
    for (const item of stack) {
      if (item.id === top.id) continue;

      if (item.stackOrder === 1 && item.status === "paused") {
        // Promote to active
        this.storage.setEntity({
          ...item,
          status: "active",
          stackOrder: 0,
          updatedAt: now,
        });
      } else if (item.stackOrder !== null && item.stackOrder > 0) {
        // Decrement stack order
        this.storage.setEntity({
          ...item,
          stackOrder: item.stackOrder - 1,
          updatedAt: now,
        });
      }
    }

    await this.storage.persistEntities();

    const newStack = this.peekStack();
    return {
      completed: { ...top, status: "completed", stackOrder: null },
      resumed: newStack.topItem ?? null,
      stack: newStack,
    };
  }

  /**
   * Get the current stack state without modification.
   */
  peekStack(): PlanningStack {
    const items = this.storage.getStack();
    const depth = items.length;
    const topItem = items.find((i) => i.status === "active");

    return { items, depth, topItem };
  }

  /**
   * Get a specific entity by ID.
   */
  getEntity(id: string): PlanningEntity | null {
    return this.storage.getEntity(id);
  }

  /**
   * Get all completed entities (for history/summarization).
   */
  getCompleted(limit: number = 20): PlanningEntity[] {
    return this.storage
      .getAllEntities()
      .filter((e) => e.status === "completed")
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .slice(0, limit);
  }

  // ============================================================================
  // Plan Operations
  // ============================================================================

  /**
   * Create a Plan linked to a Goal.
   */
  async createPlan(opts: {
    title: string;
    goalId: string;
    sourceType: PlanSourceType;
    sourceRef?: string;
  }): Promise<Plan> {
    const now = new Date().toISOString();
    const id = `plan-${randomUUID()}`;

    const plan: Plan = {
      id,
      title: opts.title,
      goalId: opts.goalId,
      sourceType: opts.sourceType,
      sourceRef: opts.sourceRef,
      createdAt: now,
      updatedAt: now,
    };

    this.storage.setPlan(plan);
    await this.storage.persistPlans();

    return plan;
  }

  /**
   * Get a Plan by its ID.
   */
  getPlan(id: string): Plan | null {
    return this.storage.getPlan(id);
  }

  /**
   * Get a Plan by its Goal ID.
   */
  getPlanByGoal(goalId: string): Plan | null {
    return this.storage.getPlanByGoal(goalId);
  }

  /**
   * Get all Plans.
   */
  getAllPlans(): Plan[] {
    return this.storage.getAllPlans();
  }

  // ============================================================================
  // PlanStep Operations
  // ============================================================================

  /**
   * Create multiple PlanSteps within a Plan.
   */
  async createSteps(
    planId: string,
    steps: Array<{
      title: string;
      ordinal: number;
      wave: number;
      externalRef: ExternalRef;
      dependsOn?: string[];
    }>
  ): Promise<PlanStep[]> {
    const now = new Date().toISOString();
    const createdSteps: PlanStep[] = [];

    for (const stepInput of steps) {
      const id = `step-${randomUUID()}`;

      const step: PlanStep = {
        id,
        planId,
        title: stepInput.title,
        ordinal: stepInput.ordinal,
        wave: stepInput.wave,
        externalRef: stepInput.externalRef,
        dependsOn: stepInput.dependsOn ?? [],
        createdAt: now,
        updatedAt: now,
      };

      this.storage.setStep(step);
      createdSteps.push(step);
    }

    await this.storage.persistSteps();

    return createdSteps;
  }

  /**
   * Get a PlanStep by its ID.
   */
  getStep(id: string): PlanStep | null {
    return this.storage.getStep(id);
  }

  /**
   * Get all PlanSteps for a Plan.
   */
  getStepsByPlan(planId: string): PlanStep[] {
    return this.storage.getStepsByPlan(planId);
  }

  /**
   * Find a PlanStep by issue number from active/paused goals only.
   * Completed goals are not searched - this is intentional to only
   * find steps that are part of currently actionable work.
   */
  findStepByIssueNumber(issueNumber: number): {
    plan: Plan;
    step: PlanStep;
    goal: Goal;
  } | null {
    // Get all active/paused goals on the stack
    const goals = this.storage
      .getStack()
      .filter((item) => item.type === "Goal") as Goal[];

    for (const goal of goals) {
      // Get the plan linked to this goal (if any)
      const plan = this.storage.getPlanByGoal(goal.id);
      if (!plan) continue;

      // Get all steps for this plan
      const steps = this.storage.getStepsByPlan(plan.id);

      // Search for a step with matching issue number
      for (const step of steps) {
        if (
          step.externalRef.type === "issue" &&
          step.externalRef.number === issueNumber
        ) {
          return { plan, step, goal };
        }
      }
    }

    return null;
  }

  // ============================================================================
  // Manual Completion Operations
  // ============================================================================

  /**
   * Check if a step is manually completed.
   */
  isManuallyCompleted(stepId: string): boolean {
    return this.storage.isManuallyCompleted(stepId);
  }

  /**
   * Mark a step as manually completed.
   */
  async setManuallyCompleted(stepId: string): Promise<void> {
    this.storage.setManuallyCompleted(stepId);
    await this.storage.persistCompletions();
    // Invalidate resolver cache so progress reflects the change immediately
    clearStatusCache();
  }

  /**
   * Get the storage instance (for resolvers to access manual completions).
   */
  getStorage(): PlanningStorage {
    return this.storage;
  }

  // ============================================================================
  // Manual Status Operations
  // ============================================================================

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
   * Compares persisted last-known status against fresh GitHub state.
   */
  async syncFromGitHub(planId?: string): Promise<{
    synced: number;
    updated: Array<{
      stepId: string;
      title: string;
      issue: number;
      oldStatus: CompletionStatus;
      newStatus: CompletionStatus;
    }>;
    unchanged: number;
    errors: Array<{ stepId: string; issue: number; error: string }>;
  }> {
    // Get plans to sync
    const plans = planId
      ? [this.storage.getPlan(planId)].filter(
          (p): p is Plan => p !== null
        )
      : this.getAllPlans();

    // Clear cache up front so all fetches hit GitHub
    clearStatusCache();

    const results = {
      synced: 0,
      updated: [] as Array<{
        stepId: string;
        title: string;
        issue: number;
        oldStatus: CompletionStatus;
        newStatus: CompletionStatus;
      }>,
      unchanged: 0,
      errors: [] as Array<{ stepId: string; issue: number; error: string }>,
    };

    let anyUpdated = false;

    for (const plan of plans) {
      const steps = this.storage.getStepsByPlan(plan.id);

      for (const step of steps) {
        if (step.externalRef.type !== "issue" || !step.externalRef.number) {
          continue;
        }

        results.synced++;

        try {
          // Read persisted last-known status (null if never synced)
          const oldStatus =
            this.storage.getResolvedStatus(step.id) ?? "not-started";

          // Fetch fresh from GitHub
          const resolver = this.resolverFactory.getResolver("issue");
          const newStatus = await resolver.resolve(step);

          // Persist the fresh status
          this.storage.setResolvedStatus(step.id, newStatus);

          if (oldStatus !== newStatus) {
            anyUpdated = true;
            results.updated.push({
              stepId: step.id,
              title: step.title,
              issue: step.externalRef.number,
              oldStatus,
              newStatus,
            });
          } else {
            results.unchanged++;
          }
        } catch (error) {
          results.errors.push({
            stepId: step.id,
            issue: step.externalRef.number,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    // Persist all resolved statuses in one write
    if (anyUpdated || results.synced > 0) {
      await this.storage.persistResolvedStatuses();
    }

    return results;
  }
}
