import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface LearningRecord {
  id: string;
  timestamp: string;
  area: string; // Code area (e.g., "auth", "api", "database")
  type: "entity" | "relationship" | "pattern" | "decision";
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * JSONL storage for learnings with area-based organization
 */
export class LearningStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private normalizeArea(area: string): string {
    const trimmed = area.trim();
    const isSafe =
      trimmed.length > 0 &&
      !trimmed.includes("..") &&
      !trimmed.includes("/") &&
      !trimmed.includes("\\");
    if (!isSafe) {
      throw new Error(`Invalid area: ${area}`);
    }
    return trimmed;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Store a learning (append to area-specific file)
   */
  async store(learning: LearningRecord): Promise<void> {
    const area = this.normalizeArea(learning.area);
    const filename = `${area}.jsonl`;
    const filepath = join(this.baseDir, filename);
    const line = `${JSON.stringify(learning)}\n`;
    await appendFile(filepath, line, "utf-8");
  }

  /**
   * Read all learnings for a specific area
   */
  async readArea(area: string): Promise<LearningRecord[]> {
    const safeArea = this.normalizeArea(area);
    const filepath = join(this.baseDir, `${safeArea}.jsonl`);

    if (!existsSync(filepath)) {
      return [];
    }

    const content = await Bun.file(filepath).text();
    const lines = content.trim().split("\n").filter(Boolean);

    return lines.map((line) => JSON.parse(line) as LearningRecord);
  }

  /**
   * Read all learnings across all areas
   */
  async readAll(): Promise<LearningRecord[]> {
    const areas = await this.listAreas();
    const allLearnings: LearningRecord[] = [];

    for (const area of areas) {
      const learnings = await this.readArea(area);
      allLearnings.push(...learnings);
    }

    return allLearnings;
  }

  /**
   * List all areas (unique area names)
   */
  async listAreas(): Promise<string[]> {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const files = await readdir(this.baseDir);
    return files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""));
  }

  /**
   * Find learning by ID (searches all areas)
   */
  async findById(id: string): Promise<LearningRecord | null> {
    const all = await this.readAll();
    return all.find((l) => l.id === id) || null;
  }
}
