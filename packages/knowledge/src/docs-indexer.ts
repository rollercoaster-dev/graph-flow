import { join, isAbsolute, basename, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import { LearningManager, type LearningType } from "./learning.ts";

export interface DocsIndexOptions {
  patterns: string[];
  cwd?: string;
  extractSections?: boolean;
  minSectionLength?: number;
  areaStrategy?: "path" | "filename" | "content";
  defaultType?: LearningType;
  onProgress?: (progress: DocsIndexProgress) => void;
}

export interface DocsIndexProgress {
  current: string;
  index: number;
  total: number;
  sectionsExtracted: number;
}

export interface DocsIndexResult {
  totalFiles: number;
  totalSections: number;
  totalLearnings: number;
  skippedDuplicates: number;
  totalTime: number;
  learningsByArea: Record<string, number>;
  errors: Array<{ file: string; error: string }>;
}

interface Section {
  title: string;
  content: string;
  level: number;
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
 * Extract sections from markdown content by headings.
 */
function extractSections(content: string, minLength: number = 50): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let contentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section if it has content
      if (currentSection && contentLines.length > 0) {
        const sectionContent = contentLines.join("\n").trim();
        if (sectionContent.length >= minLength) {
          currentSection.content = sectionContent;
          sections.push(currentSection);
        }
      }

      // Start new section
      currentSection = {
        title: headingMatch[2].trim(),
        content: "",
        level: headingMatch[1].length,
      };
      contentLines = [];
    } else if (currentSection) {
      contentLines.push(line);
    } else {
      // Content before first heading - treat as intro section
      if (line.trim()) {
        currentSection = {
          title: "Introduction",
          content: "",
          level: 0,
        };
        contentLines.push(line);
      }
    }
  }

  // Save last section
  if (currentSection && contentLines.length > 0) {
    const sectionContent = contentLines.join("\n").trim();
    if (sectionContent.length >= minLength) {
      currentSection.content = sectionContent;
      sections.push(currentSection);
    }
  }

  return sections;
}

/**
 * Compute SHA256 hash of content for deduplication.
 */
function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Detect area from file path.
 */
function areaFromPath(filepath: string): string {
  // Get first meaningful directory component
  const dir = dirname(filepath);
  // Split by platform separator, handling both / and \ for cross-platform compatibility
  const parts = dir.split(/[/\\]/).filter(Boolean);

  // Skip common directories
  const skipDirs = ["docs", "documentation", "src", "lib", "packages"];
  for (const part of parts.reverse()) {
    if (!skipDirs.includes(part.toLowerCase())) {
      return part.toLowerCase().replace(/[^a-z0-9]/g, "-");
    }
  }

  return "docs";
}

/**
 * Detect area from filename.
 */
function areaFromFilename(filepath: string): string {
  const name = basename(filepath, ".md");
  // Normalize: lowercase, replace non-alphanumeric with hyphens
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Detect area from content (first heading or first line).
 */
function areaFromContent(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      return headingMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
    const trimmed = line.trim();
    if (trimmed && trimmed.length > 0 && trimmed.length < 50) {
      return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
  }
  return "docs";
}

/**
 * Detect learning type from content heuristics.
 */
function detectType(content: string, title: string): LearningType {
  const lowerContent = content.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // Decision patterns
  if (
    lowerTitle.includes("decision") ||
    lowerTitle.includes("adr") ||
    lowerContent.includes("we decided") ||
    lowerContent.includes("decision:") ||
    lowerContent.includes("rationale:")
  ) {
    return "decision";
  }

  // Pattern patterns - code blocks alone are not sufficient
  const hasPatternKeyword =
    lowerTitle.includes("pattern") ||
    lowerTitle.includes("best practice") ||
    lowerTitle.includes("guideline") ||
    lowerContent.includes("pattern:") ||
    lowerContent.includes("example:");
  const hasCodeBlockWithPatternContext =
    lowerContent.includes("```") &&
    (lowerTitle.includes("example") ||
      lowerTitle.includes("usage") ||
      lowerContent.includes("how to"));

  if (hasPatternKeyword || hasCodeBlockWithPatternContext) {
    return "pattern";
  }

  // Relationship patterns
  if (
    lowerTitle.includes("architecture") ||
    lowerTitle.includes("integration") ||
    lowerContent.includes("depends on") ||
    lowerContent.includes("connects to") ||
    lowerContent.includes("calls")
  ) {
    return "relationship";
  }

  // Default to entity
  return "entity";
}

/**
 * DocsIndexer indexes markdown files as learnings with embeddings.
 */
export class DocsIndexer {
  private manager: LearningManager;
  private seenHashes: Set<string> = new Set();

  constructor(storageDir: string, embeddingsDir: string) {
    this.manager = new LearningManager(storageDir, embeddingsDir);
  }

  async init(): Promise<void> {
    await this.manager.init();
  }

  /**
   * Index markdown files matching the given patterns.
   */
  async index(options: DocsIndexOptions): Promise<DocsIndexResult> {
    const startTime = performance.now();
    const {
      patterns,
      cwd,
      extractSections: shouldExtract = true,
      minSectionLength = 50,
      areaStrategy = "path",
      defaultType = "entity",
      onProgress,
    } = options;

    // Expand glob patterns
    const files = await expandGlobs(patterns, cwd);

    const result: DocsIndexResult = {
      totalFiles: files.length,
      totalSections: 0,
      totalLearnings: 0,
      skippedDuplicates: 0,
      totalTime: 0,
      learningsByArea: {},
      errors: [],
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let sectionsExtracted = 0;

      try {
        const content = await Bun.file(file).text();

        // Determine area based on strategy
        let area: string;
        switch (areaStrategy) {
          case "filename":
            area = areaFromFilename(file);
            break;
          case "content":
            area = areaFromContent(content);
            break;
          case "path":
          default:
            area = areaFromPath(file);
            break;
        }

        // Ensure area is valid (no empty, no special chars)
        if (!area || area.length === 0) {
          area = "docs";
        }

        if (shouldExtract) {
          // Extract sections and index each
          const sections = extractSections(content, minSectionLength);
          sectionsExtracted = sections.length;
          result.totalSections += sections.length;

          for (const section of sections) {
            const learningContent = `## ${section.title}\n\n${section.content}`;
            const hash = computeHash(learningContent);

            if (this.seenHashes.has(hash)) {
              result.skippedDuplicates++;
              continue;
            }
            this.seenHashes.add(hash);

            const type = detectType(section.content, section.title);

            await this.manager.store({
              area,
              type,
              content: learningContent,
              metadata: {
                source: file,
                sectionTitle: section.title,
                sectionLevel: section.level,
              },
            });

            result.totalLearnings++;
            result.learningsByArea[area] = (result.learningsByArea[area] || 0) + 1;
          }
        } else {
          // Index entire file as one learning
          result.totalSections += 1;
          sectionsExtracted = 1;

          const hash = computeHash(content);

          if (this.seenHashes.has(hash)) {
            result.skippedDuplicates++;
          } else {
            this.seenHashes.add(hash);

            const type = detectType(content, basename(file));

            await this.manager.store({
              area,
              type,
              content,
              metadata: {
                source: file,
              },
            });

            result.totalLearnings++;
            result.learningsByArea[area] = (result.learningsByArea[area] || 0) + 1;
          }
        }
      } catch (error) {
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
          sectionsExtracted,
        });
      }
    }

    result.totalTime = performance.now() - startTime;
    return result;
  }

  /**
   * Clear the deduplication cache (for testing or fresh indexing).
   */
  clearHashCache(): void {
    this.seenHashes.clear();
  }
}
