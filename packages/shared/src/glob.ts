import { join, isAbsolute } from "node:path";

/**
 * Expand glob patterns in file list using Bun.Glob.
 * Non-glob paths are returned as-is.
 * Results are deduplicated.
 */
export async function expandGlobs(patterns: string[], cwd?: string): Promise<string[]> {
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
