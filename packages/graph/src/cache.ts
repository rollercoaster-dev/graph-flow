import { mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface CachedGraphData {
  fileHash: string;
  timestamp: string;
  entities: GraphEntity[];
  relationships: GraphRelationship[];
}

export interface GraphEntity {
  name: string;
  type: "function" | "class" | "interface" | "type" | "variable" | "component";
  location: {
    file: string;
    line: number;
  };
  signature?: string;
}

export interface GraphRelationship {
  from: string;
  to: string;
  type: "calls" | "imports" | "extends" | "implements" | "uses";
  location: {
    file: string;
    line: number;
  };
}

/**
 * Hash-based cache for parsed code graphs
 */
export class GraphCache {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Generate hash from file content
   */
  hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Get cache key for a file
   */
  getCacheKey(filepath: string, contentHash: string): string {
    const filename = filepath.replace(/[^a-zA-Z0-9]/g, "_");
    return `${filename}-${contentHash}.json`;
  }

  /**
   * Read from cache
   */
  async read(filepath: string, content: string): Promise<CachedGraphData | null> {
    const hash = this.hashContent(content);
    const cacheKey = this.getCacheKey(filepath, hash);
    const cachePath = join(this.baseDir, cacheKey);

    if (!existsSync(cachePath)) {
      return null;
    }

    const cached = await Bun.file(cachePath).json() as CachedGraphData;

    // Validate hash matches
    if (cached.fileHash !== hash) {
      return null;
    }

    return cached;
  }

  /**
   * Write to cache
   */
  async write(
    filepath: string,
    content: string,
    data: Omit<CachedGraphData, "fileHash" | "timestamp">
  ): Promise<void> {
    const hash = this.hashContent(content);
    const cacheKey = this.getCacheKey(filepath, hash);
    const cachePath = join(this.baseDir, cacheKey);

    const cacheData: CachedGraphData = {
      fileHash: hash,
      timestamp: new Date().toISOString(),
      ...data,
    };

    await Bun.write(cachePath, JSON.stringify(cacheData, null, 2));
  }

  /**
   * Invalidate cache for a file (delete all cache entries)
   */
  async invalidate(filepath: string): Promise<void> {
    if (!existsSync(this.baseDir)) return;
    const prefix = filepath.replace(/[^a-zA-Z0-9]/g, "_");
    const files = await readdir(this.baseDir);
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith(".json")) {
        await unlink(join(this.baseDir, file));
      }
    }
  }
}
