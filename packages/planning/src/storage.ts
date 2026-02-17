/**
 * Planning Storage
 *
 * JSONL-based storage for planning entities, following the checkpoint pattern.
 * Uses in-memory cache for fast access with <100 items.
 */

import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type {
  CompletionStatus,
  ManualStatus,
  Plan,
  PlanningEntity,
  PlanningRelationship,
  PlanStep,
  ResolvedStatus,
} from "./types";

export interface StorageOptions {
  baseDir: string;
}

interface JSONLRecord {
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Storage file names
 */
const FILES = {
  stack: "stack.jsonl",
  plans: "plans.jsonl",
  steps: "steps.jsonl",
  relationships: "relationships.jsonl",
  completions: "completions.jsonl", // Manual completion markers (legacy)
  manualStatus: "manual-status.jsonl", // Manual status overrides
  resolvedStatus: "resolved-status.jsonl", // Last-known resolved status per step
} as const;

/**
 * Planning storage with JSONL persistence and in-memory cache.
 */
export class PlanningStorage {
  private baseDir: string;

  // In-memory caches (loaded on init)
  private entities: Map<string, PlanningEntity> = new Map();
  private plans: Map<string, Plan> = new Map();
  private steps: Map<string, PlanStep> = new Map();
  private relationships: Map<string, PlanningRelationship> = new Map();
  private manualCompletions: Set<string> = new Set(); // step IDs marked as done (legacy)
  private manualStatus: Map<string, ManualStatus> = new Map(); // step status overrides
  private resolvedStatuses: Map<string, ResolvedStatus> = new Map(); // last-known resolved status

  constructor(options: StorageOptions) {
    this.baseDir = options.baseDir;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await this.loadAll();
  }

  /**
   * Load all data from JSONL files into memory.
   */
  private async loadAll(): Promise<void> {
    // Load entities
    const entityRecords = await this.readJSONL<PlanningEntity & JSONLRecord>(
      FILES.stack,
    );
    for (const record of entityRecords) {
      this.entities.set(record.id, record);
    }

    // Load plans
    const planRecords = await this.readJSONL<Plan & JSONLRecord>(FILES.plans);
    for (const record of planRecords) {
      this.plans.set(record.id, record);
    }

    // Load steps
    const stepRecords = await this.readJSONL<PlanStep & JSONLRecord>(
      FILES.steps,
    );
    for (const record of stepRecords) {
      this.steps.set(record.id, record);
    }

    // Load relationships
    const relRecords = await this.readJSONL<PlanningRelationship & JSONLRecord>(
      FILES.relationships,
    );
    for (const record of relRecords) {
      this.relationships.set(record.id, record);
    }

    // Load manual completions (legacy)
    const completionRecords = await this.readJSONL<
      { stepId: string } & JSONLRecord
    >(FILES.completions);
    for (const record of completionRecords) {
      this.manualCompletions.add(record.stepId);
    }

    // Load manual status overrides
    const statusRecords = await this.readJSONL<ManualStatus & JSONLRecord>(
      FILES.manualStatus,
    );
    for (const record of statusRecords) {
      this.manualStatus.set(record.stepId, record);
    }

    // Load resolved statuses
    const resolvedRecords = await this.readJSONL<ResolvedStatus & JSONLRecord>(
      FILES.resolvedStatus,
    );
    for (const record of resolvedRecords) {
      this.resolvedStatuses.set(record.stepId, record);
    }
  }

  /**
   * Read all records from a JSONL file.
   * Missing files return empty array. Permission/IO errors are thrown.
   * Corrupted lines are skipped with a warning.
   */
  private async readJSONL<T extends JSONLRecord>(
    filename: string,
  ): Promise<T[]> {
    const filepath = join(this.baseDir, filename);

    let content: string;
    try {
      content = await Bun.file(filepath).text();
    } catch (error: unknown) {
      // Missing file on first run is expected — start fresh
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      // Permission errors, IO errors, etc. should not be silently ignored
      throw error;
    }

    const lines = content.trim().split("\n").filter(Boolean);
    const results: T[] = [];
    let corrupted = 0;

    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        corrupted++;
      }
    }

    if (corrupted > 0) {
      console.warn(
        `[planning-storage] ${filename}: skipped ${corrupted} corrupted line(s) of ${lines.length} total`,
      );
    }

    return results;
  }

  /**
   * Write entire JSONL file atomically (write to .tmp, then rename).
   * Prevents corrupted files from mid-write crashes.
   */
  private async writeJSONL(
    filename: string,
    records: JSONLRecord[],
  ): Promise<void> {
    const filepath = join(this.baseDir, filename);
    const tmpPath = filepath + ".tmp";
    const content =
      records.length === 0
        ? ""
        : records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await Bun.write(tmpPath, content, { createPath: true });
    await rename(tmpPath, filepath);
  }

  /**
   * Persist all entity changes to disk.
   */
  async persistEntities(): Promise<void> {
    const records = Array.from(this.entities.values()).map((e) => ({
      ...e,
      timestamp: new Date().toISOString(),
    }));
    await this.writeJSONL(FILES.stack, records);
  }

  /**
   * Persist all plan changes to disk.
   */
  async persistPlans(): Promise<void> {
    const records = Array.from(this.plans.values()).map((p) => ({
      ...p,
      timestamp: new Date().toISOString(),
    }));
    await this.writeJSONL(FILES.plans, records);
  }

  /**
   * Persist all step changes to disk.
   */
  async persistSteps(): Promise<void> {
    const records = Array.from(this.steps.values()).map((s) => ({
      ...s,
      timestamp: new Date().toISOString(),
    }));
    await this.writeJSONL(FILES.steps, records);
  }

  /**
   * Persist all relationship changes to disk.
   */
  async persistRelationships(): Promise<void> {
    const records = Array.from(this.relationships.values()).map((r) => ({
      ...r,
      timestamp: new Date().toISOString(),
    }));
    await this.writeJSONL(FILES.relationships, records);
  }

  /**
   * Persist manual completions to disk.
   */
  async persistCompletions(): Promise<void> {
    const records = Array.from(this.manualCompletions).map((stepId) => ({
      stepId,
      timestamp: new Date().toISOString(),
    }));
    await this.writeJSONL(FILES.completions, records);
  }

  /**
   * Persist manual status overrides to disk.
   */
  async persistManualStatuses(): Promise<void> {
    const records = Array.from(this.manualStatus.values()).map((status) => ({
      ...status,
      timestamp: new Date().toISOString(),
    }));
    await this.writeJSONL(FILES.manualStatus, records);
  }

  // ============================================================================
  // Entity Operations
  // ============================================================================

  getEntity(id: string): PlanningEntity | null {
    return this.entities.get(id) ?? null;
  }

  getAllEntities(): PlanningEntity[] {
    return Array.from(this.entities.values());
  }

  getStack(): PlanningEntity[] {
    return Array.from(this.entities.values())
      .filter(
        (e) => e.stackOrder !== null && ["active", "paused"].includes(e.status),
      )
      .sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
  }

  /**
   * Get the currently active item on the stack.
   * Returns null if there are no active items (even if paused items exist).
   */
  getStackTop(): PlanningEntity | null {
    const stack = this.getStack();
    return stack.find((e) => e.status === "active") ?? null;
  }

  setEntity(entity: PlanningEntity): void {
    this.entities.set(entity.id, entity);
  }

  deleteEntity(id: string): void {
    this.entities.delete(id);
  }

  // ============================================================================
  // Plan Operations
  // ============================================================================

  getPlan(id: string): Plan | null {
    return this.plans.get(id) ?? null;
  }

  getPlanByGoal(goalId: string): Plan | null {
    for (const plan of this.plans.values()) {
      if (plan.goalId === goalId) {
        return plan;
      }
    }
    return null;
  }

  getAllPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  setPlan(plan: Plan): void {
    this.plans.set(plan.id, plan);
  }

  deletePlan(id: string): void {
    this.plans.delete(id);
  }

  // ============================================================================
  // Step Operations
  // ============================================================================

  getStep(id: string): PlanStep | null {
    return this.steps.get(id) ?? null;
  }

  getStepsByPlan(planId: string): PlanStep[] {
    return Array.from(this.steps.values())
      .filter((s) => s.planId === planId)
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  getAllSteps(): PlanStep[] {
    return Array.from(this.steps.values());
  }

  setStep(step: PlanStep): void {
    this.steps.set(step.id, step);
  }

  deleteStep(id: string): void {
    this.steps.delete(id);
  }

  // ============================================================================
  // Relationship Operations
  // ============================================================================

  getRelationship(id: string): PlanningRelationship | null {
    return this.relationships.get(id) ?? null;
  }

  getRelationshipsFor(entityId: string): PlanningRelationship[] {
    return Array.from(this.relationships.values()).filter(
      (r) => r.fromId === entityId || r.toId === entityId,
    );
  }

  setRelationship(rel: PlanningRelationship): void {
    this.relationships.set(rel.id, rel);
  }

  deleteRelationship(id: string): void {
    this.relationships.delete(id);
  }

  // ============================================================================
  // Manual Completion Operations (Legacy)
  // ============================================================================

  isManuallyCompleted(stepId: string): boolean {
    return this.manualCompletions.has(stepId);
  }

  setManuallyCompleted(stepId: string): void {
    this.manualCompletions.add(stepId);
  }

  clearManualCompletion(stepId: string): void {
    this.manualCompletions.delete(stepId);
  }

  // ============================================================================
  // Manual Status Operations
  // ============================================================================

  /**
   * Get manual status override for a step.
   * Returns null if no override exists.
   */
  getManualStatus(stepId: string): CompletionStatus | null {
    return this.manualStatus.get(stepId)?.status ?? null;
  }

  /**
   * Set manual status override for a step.
   */
  setManualStatus(stepId: string, status: CompletionStatus): void {
    this.manualStatus.set(stepId, {
      stepId,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Clear manual status override for a step.
   */
  clearManualStatus(stepId: string): void {
    this.manualStatus.delete(stepId);
  }

  /**
   * Get all manual status overrides.
   */
  getAllManualStatuses(): ManualStatus[] {
    return Array.from(this.manualStatus.values());
  }

  // ============================================================================
  // Resolved Status Operations
  // ============================================================================

  /**
   * Get last-known resolved status for a step.
   */
  getResolvedStatus(stepId: string): CompletionStatus | null {
    return this.resolvedStatuses.get(stepId)?.status ?? null;
  }

  /**
   * Set last-known resolved status for a step.
   */
  setResolvedStatus(stepId: string, status: CompletionStatus): void {
    this.resolvedStatuses.set(stepId, {
      stepId,
      status,
      resolvedAt: new Date().toISOString(),
    });
  }

  /**
   * Clear resolved status for a step.
   */
  clearResolvedStatus(stepId: string): void {
    this.resolvedStatuses.delete(stepId);
  }

  /**
   * Get all resolved statuses.
   */
  getAllResolvedStatuses(): ResolvedStatus[] {
    return Array.from(this.resolvedStatuses.values());
  }

  /**
   * Persist resolved statuses to disk.
   */
  async persistResolvedStatuses(): Promise<void> {
    const records = Array.from(this.resolvedStatuses.values()).map((s) => ({
      ...s,
      timestamp: new Date().toISOString(),
    }));
    await this.writeJSONL(FILES.resolvedStatus, records);
  }
}
