/**
 * Docs Graph Store
 *
 * File-based storage for DocSection entities and DOCUMENTS relationships.
 * Persists as a single JSON file with incremental hash-based updates.
 *
 * DOCUMENTS relationships are created by scanning backtick code references
 * in section content — e.g. `myFunction` in a doc section creates a link
 * from that section to any code entity named myFunction.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expandGlobs } from "@graph-flow/shared";
import { parseMarkdown } from "./parser.ts";
import type {
  DocSection,
  DocsGraph,
  DocsIndexOptions,
  DocsIndexResult,
} from "./types.ts";

const GRAPH_FILE = "docs-graph.json";

/**
 * Generate a stable ID for a section from its file path and anchor.
 */
function sectionId(filePath: string, anchor: string): string {
  return createHash("sha256")
    .update(`${filePath}:${anchor}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * SHA-256 hash of file content for incremental update detection.
 */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Extract backtick code references from markdown content.
 * Returns the unique set of identifier names found.
 */
export function extractCodeRefs(content: string): string[] {
  const pattern = /`([-a-zA-Z_.$/][a-zA-Z0-9_.$/:@-]*(?:\(\))?)`/g;
  const refs = new Set<string>();
  for (const match of content.matchAll(pattern)) {
    // Strip trailing () from function name mentions
    refs.add(match[1].replace(/\(\)$/, ""));
  }
  return [...refs];
}

/**
 * Create an empty docs graph.
 */
function emptyGraph(): DocsGraph {
  return {
    sections: {},
    codeToDoc: {},
    docToCode: {},
    fileHashes: {},
  };
}

/**
 * Manages the docs graph: indexing, storage, and relationship tracking.
 */
export class DocsStore {
  private storeDir: string;
  private graphPath: string;

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.graphPath = join(storeDir, GRAPH_FILE);
  }

  async init(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
  }

  /**
   * Load the persisted graph, or return an empty one.
   */
  async load(): Promise<DocsGraph> {
    if (!existsSync(this.graphPath)) {
      return emptyGraph();
    }

    let raw: string;
    try {
      raw = await Bun.file(this.graphPath).text();
    } catch (error) {
      throw new Error(
        `[docs/store] Failed to read graph file at "${this.graphPath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      return JSON.parse(raw) as DocsGraph;
    } catch (error) {
      throw new Error(
        `[docs/store] Graph file at "${this.graphPath}" contains invalid JSON and may be corrupted. ` +
          `Delete or restore it before re-indexing. Parse error: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  /**
   * Persist the graph to disk.
   */
  async save(graph: DocsGraph): Promise<void> {
    await Bun.write(this.graphPath, JSON.stringify(graph, null, 2));
  }

  /**
   * Index markdown files matching the given patterns.
   * Incremental: skips files whose hash hasn't changed unless force=true.
   */
  async index(options: DocsIndexOptions): Promise<DocsIndexResult> {
    const {
      patterns = ["**/*.md", "**/*.mdx"],
      cwd,
      minContentLength = 50,
      force = false,
    } = options;

    const graph = await this.load();
    const result: DocsIndexResult = {
      filesIndexed: 0,
      filesSkipped: 0,
      totalSections: 0,
      linkedToCode: 0,
      errors: [],
    };

    const files = await expandGlobs(patterns, cwd);

    for (const filePath of files) {
      try {
        const content = await Bun.file(filePath).text();
        const hash = hashContent(content);

        if (!force && graph.fileHashes[filePath] === hash) {
          result.filesSkipped++;
          continue;
        }

        // Remove old sections for this file before re-indexing
        this.removeFileSections(graph, filePath);

        const parsed = parseMarkdown(content);
        let fileSections = 0;

        for (const section of parsed) {
          if (section.content.length < minContentLength) continue;

          const id = sectionId(filePath, section.anchor);
          const codeRefs = extractCodeRefs(section.content);

          const docSection: DocSection = {
            id,
            filePath,
            heading: section.heading,
            content: section.content,
            level: section.level,
            anchor: section.anchor,
            parentAnchor: section.parentAnchor,
            isChunk: section.isChunk,
            chunkIndex: section.chunkIndex,
            codeRefs,
          };

          graph.sections[id] = docSection;

          // Build DOCUMENTS relationships
          for (const ref of codeRefs) {
            if (!graph.codeToDoc[ref]) graph.codeToDoc[ref] = [];
            if (!graph.codeToDoc[ref].includes(id)) {
              graph.codeToDoc[ref].push(id);
              result.linkedToCode++;
            }
            if (!graph.docToCode[id]) graph.docToCode[id] = [];
            if (!graph.docToCode[id].includes(ref)) {
              graph.docToCode[id].push(ref);
            }
          }

          fileSections++;
        }

        graph.fileHashes[filePath] = hash;
        result.totalSections += fileSections;
        result.filesIndexed++;
      } catch (error) {
        result.errors.push({
          file: filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.save(graph);
    return result;
  }

  /**
   * Remove all sections belonging to a file (for re-indexing).
   */
  private removeFileSections(graph: DocsGraph, filePath: string): void {
    for (const [id, section] of Object.entries(graph.sections)) {
      if (section.filePath !== filePath) continue;

      // Remove from codeToDoc
      for (const ref of section.codeRefs) {
        if (graph.codeToDoc[ref]) {
          graph.codeToDoc[ref] = graph.codeToDoc[ref].filter((s) => s !== id);
          if (graph.codeToDoc[ref].length === 0) {
            delete graph.codeToDoc[ref];
          }
        }
      }

      // Remove from docToCode
      delete graph.docToCode[id];
      delete graph.sections[id];
    }

    delete graph.fileHashes[filePath];
  }
}
