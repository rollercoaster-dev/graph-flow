import { join, isAbsolute, relative } from "node:path";

/** Directories always excluded from indexing, regardless of .gitignore */
const ALWAYS_EXCLUDED_DIRS = ["node_modules"];

/**
 * Parse a .gitignore file and return pre-compiled positive patterns.
 * Skips blank lines, comments (#), and negation patterns (!).
 */
async function loadGitignorePatterns(
  dir: string
): Promise<{ glob: InstanceType<typeof Bun.Glob>; dirOnly: boolean }[]> {
  try {
    const content = await Bun.file(join(dir, ".gitignore")).text();
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
      .map((line) => {
        const dirOnly = line.endsWith("/");
        const raw = dirOnly ? line.slice(0, -1) : line;
        return { glob: new Bun.Glob(raw), dirOnly };
      });
  } catch {
    return [];
  }
}

/**
 * Check whether a relative path should be excluded based on
 * hard-coded directory exclusions and parsed .gitignore patterns.
 */
function shouldExclude(
  relativePath: string,
  patterns: { glob: InstanceType<typeof Bun.Glob>; dirOnly: boolean }[]
): boolean {
  const segments = relativePath.split("/");

  // Always exclude hard-coded directories
  if (segments.some((s) => ALWAYS_EXCLUDED_DIRS.includes(s))) return true;

  const filename = segments[segments.length - 1];

  for (const { glob, dirOnly } of patterns) {
    if (dirOnly) {
      // Directory pattern (e.g. "dist/"): exclude if any segment matches
      if (segments.some((s) => glob.match(s))) return true;
    } else {
      // File pattern: match against full relative path or just filename
      if (glob.match(relativePath) || glob.match(filename)) return true;
    }
  }

  return false;
}

/**
 * Expand glob patterns in file list using Bun.Glob.
 * Non-glob paths are returned as-is.
 * Results are deduplicated.
 * Respects .gitignore and always excludes node_modules.
 */
export async function expandGlobs(
  patterns: string[],
  cwd?: string
): Promise<string[]> {
  const effectiveCwd = cwd || process.cwd();
  const ignorePatterns = await loadGitignorePatterns(effectiveCwd);

  const files: string[] = [];
  for (const pattern of patterns) {
    if (
      pattern.includes("*") ||
      pattern.includes("?") ||
      pattern.includes("{")
    ) {
      const glob = new Bun.Glob(pattern);
      for await (const path of glob.scan({ cwd, dot: false })) {
        if (!shouldExclude(path, ignorePatterns)) {
          // Make path absolute if cwd is provided
          const fullPath = cwd && !isAbsolute(path) ? join(cwd, path) : path;
          files.push(fullPath);
        }
      }
    } else {
      // Non-glob path: make absolute if cwd provided and path is relative
      const fullPath =
        cwd && !isAbsolute(pattern) ? join(cwd, pattern) : pattern;
      const relPath = isAbsolute(fullPath)
        ? relative(effectiveCwd, fullPath)
        : pattern;
      if (!shouldExclude(relPath, ignorePatterns)) {
        files.push(fullPath);
      }
    }
  }
  return [...new Set(files)];
}
