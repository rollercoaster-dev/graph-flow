import { join, resolve } from "node:path";
import { mkdir, stat, access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { CodeIndexer, type IndexResult } from "@graph-flow/graph";
import { DocsIndexer, type DocsIndexResult } from "@graph-flow/knowledge";

export interface InitOptions {
  projectRoot?: string;
  indexCode?: boolean;
  indexDocs?: boolean;
  codePatterns?: string[];
  docsPatterns?: string[];
}

export interface InitResult {
  projectRoot: string;
  dataDir: string;
  mcpConfig: object;
  codeIndexResult?: IndexResult;
  docsIndexResult?: DocsIndexResult;
  healthCheck: HealthCheckResult;
}

export interface HealthCheckResult {
  dataDir: { exists: boolean; writable: boolean };
  graphs: { files: number };
  learnings: { files: number; areas: string[] };
  embeddings: { files: number };
  workflows: { files: number };
  planning: { files: number };
}

/**
 * Check if a directory exists.
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a directory is writable.
 */
async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Count files in a directory (non-recursive, excludes subdirectories).
 */
async function countFiles(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

/**
 * Get subdirectory names (areas) in a directory.
 */
async function getSubdirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Auto-detect code patterns based on project structure.
 */
async function detectCodePatterns(projectRoot: string): Promise<string[]> {
  const patterns: string[] = [];

  // Check for common source directories
  const srcDirs = ["src", "lib", "packages"];
  for (const dir of srcDirs) {
    if (await dirExists(join(projectRoot, dir))) {
      patterns.push(`${dir}/**/*.ts`);
      patterns.push(`${dir}/**/*.tsx`);
      patterns.push(`${dir}/**/*.js`);
      patterns.push(`${dir}/**/*.jsx`);
      patterns.push(`${dir}/**/*.vue`);
    }
  }

  // If no src directories found, check root for code files
  if (patterns.length === 0) {
    patterns.push("**/*.ts");
    patterns.push("**/*.tsx");
    patterns.push("**/*.js");
    patterns.push("**/*.jsx");
    patterns.push("**/*.vue");
  }

  return patterns;
}

/**
 * Auto-detect docs patterns based on project structure.
 */
async function detectDocsPatterns(projectRoot: string): Promise<string[]> {
  const patterns: string[] = [];

  // Check for common docs directories
  const docsDirs = ["docs", "documentation", "doc"];
  for (const dir of docsDirs) {
    if (await dirExists(join(projectRoot, dir))) {
      patterns.push(`${dir}/**/*.md`);
    }
  }

  // Always include root-level markdown files (README, CONTRIBUTING, etc.)
  patterns.push("*.md");

  return patterns;
}

/**
 * Run health check on the data directory.
 */
async function runHealthCheck(dataDir: string): Promise<HealthCheckResult> {
  const graphsDir = join(dataDir, "graphs");
  const learningsDir = join(dataDir, "learnings");
  const embeddingsDir = join(dataDir, "embeddings");
  const workflowsDir = join(dataDir, "workflows");
  const planningDir = join(dataDir, "planning");

  return {
    dataDir: {
      exists: await dirExists(dataDir),
      writable: await isWritable(dataDir),
    },
    graphs: {
      files: await countFiles(graphsDir),
    },
    learnings: {
      files: await countFiles(learningsDir),
      areas: await getSubdirs(learningsDir),
    },
    embeddings: {
      files: await countFiles(embeddingsDir),
    },
    workflows: {
      files: await countFiles(workflowsDir),
    },
    planning: {
      files: await countFiles(planningDir),
    },
  };
}

/**
 * Generate MCP config snippet for the user.
 */
function generateMcpConfig(projectRoot: string): object {
  return {
    mcpServers: {
      "graph-flow": {
        command: "bunx",
        args: ["@graph-flow/mcp"],
        env: {
          CLAUDE_PROJECT_DIR: projectRoot,
        },
      },
    },
  };
}

/**
 * Initialize graph-flow for a project.
 */
export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const {
    projectRoot = process.cwd(),
    indexCode = true,
    indexDocs = true,
    codePatterns,
    docsPatterns,
  } = options;

  const resolvedRoot = resolve(projectRoot);
  const dataDir = join(resolvedRoot, ".claude");

  // Create data directories
  const dirs = ["graphs", "learnings", "embeddings", "workflows", "planning"];
  for (const dir of dirs) {
    await mkdir(join(dataDir, dir), { recursive: true });
  }

  const result: Partial<InitResult> = {
    projectRoot: resolvedRoot,
    dataDir,
    mcpConfig: generateMcpConfig(resolvedRoot),
  };

  // Index code if enabled
  if (indexCode) {
    const patterns = codePatterns ?? (await detectCodePatterns(resolvedRoot));
    if (patterns.length > 0) {
      const indexer = new CodeIndexer(join(dataDir, "graphs"));
      await indexer.init();
      result.codeIndexResult = await indexer.index({
        patterns,
        cwd: resolvedRoot,
      });
    }
  }

  // Index docs if enabled
  if (indexDocs) {
    const patterns = docsPatterns ?? (await detectDocsPatterns(resolvedRoot));
    if (patterns.length > 0) {
      const indexer = new DocsIndexer(
        join(dataDir, "learnings"),
        join(dataDir, "embeddings")
      );
      await indexer.init();
      result.docsIndexResult = await indexer.index({
        patterns,
        cwd: resolvedRoot,
      });
    }
  }

  // Run health check after indexing
  result.healthCheck = await runHealthCheck(dataDir);

  return result as InitResult;
}

/**
 * Format init result for display.
 */
export function formatInitResult(result: InitResult): string {
  const lines: string[] = [];

  lines.push("graph-flow initialized successfully!");
  lines.push("");
  lines.push(`Project root: ${result.projectRoot}`);
  lines.push(`Data directory: ${result.dataDir}`);
  lines.push("");

  if (result.codeIndexResult) {
    const r = result.codeIndexResult;
    lines.push("Code indexing:");
    lines.push(`  Files: ${r.totalFiles} (${r.parsedFiles} parsed, ${r.cachedFiles} cached)`);
    lines.push(`  Entities: ${r.totalEntities}`);
    lines.push(`  Relationships: ${r.totalRelationships}`);
    if (r.failedFiles > 0) {
      lines.push(`  Failed: ${r.failedFiles}`);
    }
    lines.push(`  Time: ${r.totalTime.toFixed(0)}ms`);
    lines.push("");
  }

  if (result.docsIndexResult) {
    const r = result.docsIndexResult;
    lines.push("Docs indexing:");
    lines.push(`  Files: ${r.totalFiles}`);
    lines.push(`  Sections: ${r.totalSections}`);
    lines.push(`  Learnings: ${r.totalLearnings}`);
    if (r.skippedDuplicates > 0) {
      lines.push(`  Skipped duplicates: ${r.skippedDuplicates}`);
    }
    if (Object.keys(r.learningsByArea).length > 0) {
      lines.push(`  Areas: ${Object.keys(r.learningsByArea).join(", ")}`);
    }
    lines.push(`  Time: ${r.totalTime.toFixed(0)}ms`);
    lines.push("");
  }

  lines.push("Health check:");
  const h = result.healthCheck;
  lines.push(`  Data dir: ${h.dataDir.exists ? "exists" : "missing"}, ${h.dataDir.writable ? "writable" : "not writable"}`);
  lines.push(`  Graphs: ${h.graphs.files} files`);
  lines.push(`  Learnings: ${h.learnings.files} files, areas: [${h.learnings.areas.join(", ")}]`);
  lines.push(`  Embeddings: ${h.embeddings.files} files`);
  lines.push(`  Workflows: ${h.workflows.files} files`);
  lines.push(`  Planning: ${h.planning.files} files`);
  lines.push("");

  lines.push("MCP Configuration (add to your Claude config):");
  lines.push(JSON.stringify(result.mcpConfig, null, 2));

  return lines.join("\n");
}
