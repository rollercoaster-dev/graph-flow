/**
 * Planning Storage
 *
 * JSONL-based storage for planning entities, following the checkpoint pattern.
 * Uses in-memory cache for fast access with <100 items.
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  PlanningEntity,
  PlanningRelationship,
  Plan,
  PlanStep,
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
  completions: "completions.jsonl", // Manual completion markers
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
  private manualCompletions: Set<string> = new Set(); // step IDs marked as done

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
      FILES.stack
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
      FILES.steps
    );
    for (const record of stepRecords) {
      this.steps.set(record.id, record);
    }

    // Load relationships
    const relRecords = await this.readJSONL<PlanningRelationship & JSONLRecord>(
      FILES.relationships
    );
    for (const record of relRecords) {
      this.relationships.set(record.id, record);
    }

    // Load manual completions
    const completionRecords = await this.readJSONL<
      { stepId: string } & JSONLRecord
    >(FILES.completions);
    for (const record of completionRecords) {
      this.manualCompletions.add(record.stepId);
    }
  }

  /**
   * Read all records from a JSONL file.
   * Handles missing files and corrupted lines gracefully.
   */
  private async readJSONL<T extends JSONLRecord>(filename: string): Promise<T[]> {
    const filepath = join(this.baseDir, filename);

    let content: string;
    try {
      content = await Bun.file(filepath).text();
    } catch {
      // File doesn't exist or can't be read - start fresh
      return [];
    }

    const lines = content.trim().split("\n").filter(Boolean);
    const results: T[] = [];

    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip corrupted lines - graceful degradation
      }
    }

    return results;
  }

  /**
   * Write entire JSONL file (replaces existing content).
   */
  private async writeJSONL(
    filename: string,
    records: JSONLRecord[]
  ): Promise<void> {
    const filepath = join(this.baseDir, filename);
    if (records.length === 0) {
      // Write empty file
      await Bun.write(filepath, "", { createPath: true });
      return;
    }
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await Bun.write(filepath, content, { createPath: true });
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
      .filter((e) => e.stackOrder !== null && ["active", "paused"].includes(e.status))
      .sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
  }

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
      (r) => r.fromId === entityId || r.toId === entityId
    );
  }

  setRelationship(rel: PlanningRelationship): void {
    this.relationships.set(rel.id, rel);
  }

  deleteRelationship(id: string): void {
    this.relationships.delete(id);
  }

  // ============================================================================
  // Manual Completion Operations
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
}
