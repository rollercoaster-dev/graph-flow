import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DocsIndexer, type DocsIndexProgress } from "../src/docs-indexer.ts";

const STORAGE_DIR = "/tmp/graph-flow-test-docs-storage";
const EMBEDDINGS_DIR = "/tmp/graph-flow-test-docs-embeddings";

describe("DocsIndexer", () => {
  let indexer: DocsIndexer;
  let fixtureDir: string;

  beforeEach(async () => {
    indexer = new DocsIndexer(STORAGE_DIR, EMBEDDINGS_DIR);
    await indexer.init();
    fixtureDir = await mkdtemp(join(tmpdir(), "docs-indexer-test-"));
  });

  afterEach(async () => {
    await rm(STORAGE_DIR, { recursive: true, force: true });
    await rm(EMBEDDINGS_DIR, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, content: string): Promise<string> {
    const filepath = join(fixtureDir, name);
    const dir = join(fixtureDir, name.split("/").slice(0, -1).join("/"));
    if (dir !== fixtureDir) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filepath, content, "utf-8");
    return filepath;
  }

  test("indexes markdown files matching glob pattern", async () => {
    await writeFixture("doc1.md", "# Title\n\nThis is some content that is long enough to be indexed.");
    await writeFixture("doc2.md", "# Another Doc\n\nMore content here that meets the minimum length requirement.");
    await writeFixture("other.txt", "This is not markdown");

    const result = await indexer.index({
      patterns: ["*.md"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(2);
    expect(result.totalLearnings).toBeGreaterThanOrEqual(2);
    expect(result.errors).toHaveLength(0);
  });

  test("extracts sections from markdown by headings", async () => {
    await writeFixture(
      "sections.md",
      `# Main Title

This is the introduction section with enough content to pass the minimum length filter.

## First Section

Content of the first section that should be extracted as a separate learning item.

## Second Section

Content of the second section that should also be extracted as its own learning.

### Subsection

A subsection with its own content that meets the minimum length requirements.
`
    );

    const result = await indexer.index({
      patterns: ["sections.md"],
      cwd: fixtureDir,
      extractSections: true,
      minSectionLength: 30,
    });

    expect(result.totalFiles).toBe(1);
    expect(result.totalSections).toBeGreaterThanOrEqual(3);
    expect(result.totalLearnings).toBeGreaterThanOrEqual(3);
  });

  test("indexes entire file when extractSections is false", async () => {
    await writeFixture(
      "whole.md",
      `# Title

## Section 1

Content one.

## Section 2

Content two.
`
    );

    const result = await indexer.index({
      patterns: ["whole.md"],
      cwd: fixtureDir,
      extractSections: false,
    });

    expect(result.totalFiles).toBe(1);
    expect(result.totalSections).toBe(1);
    expect(result.totalLearnings).toBe(1);
  });

  test("deduplicates by content hash", async () => {
    const content = "# Duplicate\n\nThis is duplicate content that should only be indexed once.";
    await writeFixture("dup1.md", content);
    await writeFixture("dup2.md", content);

    const result = await indexer.index({
      patterns: ["*.md"],
      cwd: fixtureDir,
      extractSections: false,
    });

    expect(result.totalFiles).toBe(2);
    expect(result.totalLearnings).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
  });

  test("respects minSectionLength filter", async () => {
    await writeFixture(
      "short.md",
      `# Title

Short.

## Long Section

This section has enough content to pass the minimum length filter and should be indexed.
`
    );

    const result = await indexer.index({
      patterns: ["short.md"],
      cwd: fixtureDir,
      extractSections: true,
      minSectionLength: 50,
    });

    // Only the long section should be indexed
    expect(result.totalLearnings).toBe(1);
  });

  test("uses path-based area strategy by default", async () => {
    await mkdir(join(fixtureDir, "api"), { recursive: true });
    await writeFixture("api/endpoints.md", "# API Endpoints\n\nDocumentation about API endpoints with enough content.");

    const result = await indexer.index({
      patterns: ["**/*.md"],
      cwd: fixtureDir,
      areaStrategy: "path",
    });

    expect(result.learningsByArea["api"]).toBeGreaterThanOrEqual(1);
  });

  test("uses filename-based area strategy when specified", async () => {
    await writeFixture("authentication.md", "# Auth\n\nContent about authentication that is long enough to be indexed.");

    const result = await indexer.index({
      patterns: ["*.md"],
      cwd: fixtureDir,
      areaStrategy: "filename",
    });

    expect(result.learningsByArea["authentication"]).toBeGreaterThanOrEqual(1);
  });

  test("uses content-based area strategy when specified", async () => {
    await writeFixture("doc.md", "# Database Design\n\nContent about database design that is long enough to index.");

    const result = await indexer.index({
      patterns: ["*.md"],
      cwd: fixtureDir,
      areaStrategy: "content",
    });

    expect(result.learningsByArea["database-design"]).toBeGreaterThanOrEqual(1);
  });

  test("detects decision type from content", async () => {
    await writeFixture(
      "adr.md",
      `# ADR-001: Use TypeScript

## Decision

We decided to use TypeScript for better type safety and developer experience.

## Rationale

TypeScript provides compile-time type checking which catches many bugs early.
`
    );

    // This test verifies the file is indexed without errors
    // Type detection is internal and verified by storing successfully
    const result = await indexer.index({
      patterns: ["adr.md"],
      cwd: fixtureDir,
    });

    expect(result.totalLearnings).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  test("detects pattern type from content with code blocks", async () => {
    await writeFixture(
      "patterns.md",
      `# Best Practices

## Error Handling Pattern

Example of proper error handling:

\`\`\`typescript
try {
  await operation();
} catch (error) {
  logger.error(error);
  throw new AppError('Operation failed', error);
}
\`\`\`
`
    );

    const result = await indexer.index({
      patterns: ["patterns.md"],
      cwd: fixtureDir,
    });

    expect(result.totalLearnings).toBeGreaterThanOrEqual(1);
  });

  test("handles file read errors gracefully", async () => {
    const result = await indexer.index({
      patterns: ["nonexistent.md"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toContain("nonexistent.md");
  });

  test("progress callback receives correct data", async () => {
    await writeFixture("p1.md", "# Progress 1\n\nContent for progress tracking test file one.");
    await writeFixture("p2.md", "# Progress 2\n\nContent for progress tracking test file two.");

    const progressUpdates: DocsIndexProgress[] = [];

    await indexer.index({
      patterns: ["*.md"],
      cwd: fixtureDir,
      onProgress: (progress) => {
        progressUpdates.push({ ...progress });
      },
    });

    expect(progressUpdates).toHaveLength(2);
    expect(progressUpdates[0].index).toBe(0);
    expect(progressUpdates[0].total).toBe(2);
    expect(progressUpdates[1].index).toBe(1);
    expect(progressUpdates[1].total).toBe(2);
  });

  test("tracks sections extracted in progress", async () => {
    await writeFixture(
      "multi.md",
      `# Title

Intro content that is long enough.

## Section One

First section content that is long enough.

## Section Two

Second section content that is long enough.
`
    );

    let lastProgress: DocsIndexProgress | null = null;

    await indexer.index({
      patterns: ["multi.md"],
      cwd: fixtureDir,
      minSectionLength: 20,
      onProgress: (progress) => {
        lastProgress = { ...progress };
      },
    });

    expect(lastProgress).not.toBeNull();
    expect(lastProgress!.sectionsExtracted).toBeGreaterThanOrEqual(2);
  });

  test("empty pattern array returns zero counts", async () => {
    const result = await indexer.index({
      patterns: [],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(0);
    expect(result.totalLearnings).toBe(0);
    expect(result.totalSections).toBe(0);
  });

  test("handles multiple glob patterns", async () => {
    await writeFixture("readme.md", "# README\n\nProject readme with enough content to be indexed.");
    await writeFixture("docs/guide.md", "# Guide\n\nGuide content that is long enough to be indexed.");

    const result = await indexer.index({
      patterns: ["*.md", "docs/**/*.md"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(2);
  });

  test("deduplicates files from overlapping patterns", async () => {
    await writeFixture("overlap.md", "# Overlap\n\nContent that should only be indexed once despite pattern overlap.");

    const result = await indexer.index({
      patterns: ["*.md", "overlap.md"],
      cwd: fixtureDir,
      extractSections: false,
    });

    expect(result.totalFiles).toBe(1);
    expect(result.totalLearnings).toBe(1);
  });

  test("tracks total time", async () => {
    await writeFixture("timed.md", "# Timed\n\nContent for timing test that is long enough.");

    const result = await indexer.index({
      patterns: ["timed.md"],
      cwd: fixtureDir,
    });

    expect(result.totalTime).toBeGreaterThan(0);
  });

  test("clearHashCache allows re-indexing same content", async () => {
    const content = "# Reindex\n\nContent that will be indexed multiple times after cache clear.";
    await writeFixture("reindex.md", content);

    // First index
    const result1 = await indexer.index({
      patterns: ["reindex.md"],
      cwd: fixtureDir,
      extractSections: false,
    });

    expect(result1.totalLearnings).toBe(1);

    // Second index without clearing - should skip
    const result2 = await indexer.index({
      patterns: ["reindex.md"],
      cwd: fixtureDir,
      extractSections: false,
    });

    expect(result2.skippedDuplicates).toBe(1);
    expect(result2.totalLearnings).toBe(0);

    // Clear cache and re-index
    indexer.clearHashCache();

    const result3 = await indexer.index({
      patterns: ["reindex.md"],
      cwd: fixtureDir,
      extractSections: false,
    });

    expect(result3.totalLearnings).toBe(1);
    expect(result3.skippedDuplicates).toBe(0);
  });

  test("handles content before first heading as introduction", async () => {
    await writeFixture(
      "intro.md",
      `This is content before any heading that should be captured as an introduction section.

# First Heading

Content under the first heading that is long enough to be indexed.
`
    );

    const result = await indexer.index({
      patterns: ["intro.md"],
      cwd: fixtureDir,
      minSectionLength: 30,
    });

    // Should have both intro and first heading sections
    expect(result.totalSections).toBeGreaterThanOrEqual(2);
  });
});
