import { LearningStorage, type LearningRecord } from "./storage.ts";
import { LearningSearch } from "./search.ts";
import { randomUUID } from "node:crypto";

export type LearningType = "entity" | "relationship" | "pattern" | "decision";

export interface StoreLearningParams {
  area: string;
  type: LearningType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface QueryParams {
  text?: string;
  area?: string;
  type?: LearningType;
  limit?: number;
}

/**
 * Learning manager with storage and search
 */
export class LearningManager {
  private storage: LearningStorage;
  private search: LearningSearch;

  constructor(storageDir: string) {
    this.storage = new LearningStorage(storageDir);
    this.search = new LearningSearch();
  }

  async init(): Promise<void> {
    await this.storage.init();
  }

  /**
   * Store a new learning
   */
  async store(params: StoreLearningParams): Promise<LearningRecord> {
    const learning: LearningRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      area: params.area,
      type: params.type,
      content: params.content,
      metadata: params.metadata,
    };

    await this.storage.store(learning);

    // Clear search cache since learnings have changed
    this.search.clearCache();

    return learning;
  }

  /**
   * Query learnings
   */
  async query(params: QueryParams): Promise<LearningRecord[]> {
    let learnings: LearningRecord[];

    // Filter by area if specified
    if (params.area) {
      learnings = await this.storage.readArea(params.area);
    } else {
      learnings = await this.storage.readAll();
    }

    // Filter by type if specified
    if (params.type) {
      learnings = learnings.filter(l => l.type === params.type);
    }

    // Search by text if specified
    if (params.text) {
      learnings = this.search.search(params.text, learnings, params.limit || 10);
    } else if (params.limit) {
      // Just limit results if no text search
      learnings = learnings.slice(0, params.limit);
    }

    return learnings;
  }

  /**
   * Get learning by ID
   */
  async get(id: string): Promise<LearningRecord | null> {
    return this.storage.findById(id);
  }

  /**
   * Get related learnings (same area or similar content)
   */
  async getRelated(id: string, limit: number = 5): Promise<LearningRecord[]> {
    const learning = await this.storage.findById(id);
    if (!learning) {
      return [];
    }

    // Get learnings from same area
    const sameArea = await this.storage.readArea(learning.area);

    // Search for similar content
    const related = this.search.search(learning.content, sameArea, limit + 1);

    // Filter out the original learning and limit
    return related.filter(l => l.id !== id).slice(0, limit);
  }

  /**
   * List all areas
   */
  async listAreas(): Promise<string[]> {
    return this.storage.listAreas();
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalLearnings: number;
    totalAreas: number;
    byType: Record<LearningType, number>;
  }> {
    const all = await this.storage.readAll();
    const areas = await this.storage.listAreas();

    const byType: Record<LearningType, number> = {
      entity: 0,
      relationship: 0,
      pattern: 0,
      decision: 0,
    };

    for (const learning of all) {
      byType[learning.type]++;
    }

    return {
      totalLearnings: all.length,
      totalAreas: areas.length,
      byType,
    };
  }
}
