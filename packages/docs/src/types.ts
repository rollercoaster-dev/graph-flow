/**
 * Type definitions for the docs graph module.
 *
 * DocSection represents a parsed section from a markdown file.
 * DocsGraph is the full in-memory/persisted graph structure including
 * DOCUMENTS relationships that link doc sections to code entity names.
 */

/**
 * A parsed section from a markdown document.
 */
export interface DocSection {
  /** SHA-256 hash of filePath + anchor — globally unique */
  id: string;
  /** Relative file path to the markdown source */
  filePath: string;
  /** Heading text for this section */
  heading: string;
  /** Content under this heading (excluding child headings) */
  content: string;
  /** Heading level 1–6 */
  level: number;
  /** URL-friendly anchor (GitHub slug rules) */
  anchor: string;
  /** Parent section's anchor, if any */
  parentAnchor?: string;
  /** True if this section was split due to token limit */
  isChunk?: boolean;
  /** Chunk index within a split section */
  chunkIndex?: number;
  /** Code entity names mentioned in this section via backticks */
  codeRefs: string[];
}

/**
 * Full docs graph: sections, relationships, and file hashes for incremental indexing.
 */
export interface DocsGraph {
  /** All indexed sections keyed by section ID */
  sections: Record<string, DocSection>;
  /** Code entity name → section IDs that mention it (DOCUMENTS relationships) */
  codeToDoc: Record<string, string[]>;
  /** Section ID → code entity names it documents */
  docToCode: Record<string, string[]>;
  /** File path → SHA-256 hash for incremental updates */
  fileHashes: Record<string, string>;
}

/**
 * Options for indexing a set of markdown files.
 */
export interface DocsIndexOptions {
  /** Glob patterns for markdown files, e.g. ['docs/**\/*.md', 'README.md'] */
  patterns: string[];
  /** Working directory for glob expansion (default: cwd) */
  cwd?: string;
  /** Minimum section content length to index in chars (default: 50) */
  minContentLength?: number;
  /** Force re-index even if file hash matches (default: false) */
  force?: boolean;
}

/**
 * Result of indexing a set of markdown files.
 */
export interface DocsIndexResult {
  filesIndexed: number;
  filesSkipped: number;
  totalSections: number;
  linkedToCode: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * A single search result from d-query.
 */
export interface DocSearchResult {
  section: DocSection;
  similarity: number;
}

/**
 * Options for d-query semantic search.
 */
export interface DocSearchOptions {
  /** Maximum results (default: 10) */
  limit?: number;
  /** Minimum similarity threshold 0.0–1.0 (default: 0.3) */
  threshold?: number;
}
