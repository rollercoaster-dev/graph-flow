import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface StorageOptions {
  baseDir: string;
}

export interface JSONLRecord {
  timestamp: string;
  [key: string]: unknown;
}

/**
 * JSONL storage operations - append-only writes, no locks
 */
export class JSONLStorage {
  private baseDir: string;

  constructor(options: StorageOptions) {
    this.baseDir = options.baseDir;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Append a record to a JSONL file
   */
  async append(filename: string, record: JSONLRecord): Promise<void> {
    const filepath = join(this.baseDir, filename);
    const line = JSON.stringify(record) + "\n";
    await appendFile(filepath, line, "utf-8");
  }

  /**
   * Read all records from a JSONL file
   */
  async read<T extends JSONLRecord>(filename: string): Promise<T[]> {
    const filepath = join(this.baseDir, filename);

    if (!existsSync(filepath)) {
      return [];
    }

    const content = await Bun.file(filepath).text();
    const lines = content.trim().split("\n").filter(Boolean);

    return lines.map((line) => JSON.parse(line) as T);
  }

  /**
   * Write entire JSONL file (replaces existing content)
   */
  async write(filename: string, records: JSONLRecord[]): Promise<void> {
    const filepath = join(this.baseDir, filename);
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await Bun.write(filepath, content, { createPath: true });
  }

  /**
   * Delete a JSONL file
   */
  async delete(filename: string): Promise<void> {
    const filepath = join(this.baseDir, filename);
    if (existsSync(filepath)) {
      await unlink(filepath);
    }
  }

  /**
   * List all JSONL files in directory
   */
  async list(): Promise<string[]> {
    if (!existsSync(this.baseDir)) {
      return [];
    }
    const files = await readdir(this.baseDir);
    return files.filter((f) => f.endsWith(".jsonl"));
  }

  /**
   * Check if file exists
   */
  exists(filename: string): boolean {
    return existsSync(join(this.baseDir, filename));
  }
}
