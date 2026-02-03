import { join, isAbsolute } from "node:path";
import { CodeParser } from "./parser.ts";
import { GraphCache } from "./cache.ts";

export interface IndexOptions {
  patterns: string[];
  cwd?: string;
  onProgress?: (progress: IndexProgress) => void;
}

export interface IndexProgress {
  current: string;
  index: number;
  total: number;
  cached: boolean;
  failed: boolean;
}

export interface IndexResult {
  totalFiles: number;
  cachedFiles: number;
  parsedFiles: number;
  failedFiles: number;
  totalEntities: number;
  totalRelationships: number;
  totalTime: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Expand glob patterns in file list using Bun.Glob.
 * Non-glob paths are returned as-is.
 */
async function expandGlobs(patterns: string[], cwd?: string): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("{")) {
      const glob = new Bun.Glob(pattern);
      for await (const path of glob.scan({ cwd, dot: false })) {
        // Make path absolute if cwd is provided
        const fullPath = cwd && !isAbsolute(path) ? join(cwd, path) : path;
        files.push(fullPath);
      }
    } else {
      // Non-glob path: make absolute if cwd provided and path is relative
      const fullPath = cwd && !isAbsolute(pattern) ? join(cwd, pattern) : pattern;
      files.push(fullPath);
    }
  }
  return [...new Set(files)];
}

/**
 * Batch indexer for code files that populates the graph cache.
 */
export class CodeIndexer {
  private parser: CodeParser;
  private cache: GraphCache;
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.parser = new CodeParser(cacheDir);
    this.cache = new GraphCache(cacheDir);
  }

  async init(): Promise<void> {
    await this.parser.init();
  }

  /**
   * Index files matching the given patterns.
   * Idempotent: files already in cache are skipped.
   */
  async index(options: IndexOptions): Promise<IndexResult> {
    const startTime = performance.now();
    const { patterns, cwd, onProgress } = options;

    // Expand glob patterns
    const files = await expandGlobs(patterns, cwd);

    const result: IndexResult = {
      totalFiles: files.length,
      cachedFiles: 0,
      parsedFiles: 0,
      failedFiles: 0,
      totalEntities: 0,
      totalRelationships: 0,
      totalTime: 0,
      errors: [],
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let cached = false;
      let failed = false;

      try {
        // Read file content to check cache
        const content = await Bun.file(file).text();

        // Check if already cached
        const cachedData = await this.cache.read(file, content);
        cached = cachedData !== null;

        if (cached) {
          result.cachedFiles++;
          result.totalEntities += cachedData.entities.length;
          result.totalRelationships += cachedData.relationships.length;
        } else {
          // Parse file (this will also cache the result)
          const parseResult = await this.parser.parse(file);
          result.parsedFiles++;
          result.totalEntities += parseResult.entities.length;
          result.totalRelationships += parseResult.relationships.length;
        }
      } catch (error) {
        failed = true;
        result.failedFiles++;
        result.errors.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Report progress
      if (onProgress) {
        onProgress({
          current: file,
          index: i,
          total: files.length,
          cached,
          failed,
        });
      }
    }

    result.totalTime = performance.now() - startTime;
    return result;
  }
}
