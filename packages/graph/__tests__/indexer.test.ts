import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { CodeIndexer, type IndexProgress } from "../src/indexer.ts";

const CACHE_DIR = "/tmp/graph-flow-test-indexer-cache";

describe("CodeIndexer", () => {
  let indexer: CodeIndexer;
  let fixtureDir: string;

  beforeEach(async () => {
    indexer = new CodeIndexer(CACHE_DIR);
    await indexer.init();
    fixtureDir = await mkdtemp(join(tmpdir(), "graph-indexer-test-"));
  });

  afterEach(async () => {
    await rm(CACHE_DIR, { recursive: true, force: true });
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

  test("indexes multiple files matching glob pattern", async () => {
    await writeFixture("a.ts", "export function foo() {}");
    await writeFixture("b.ts", "export function bar() {}");
    await writeFixture("c.js", "export function baz() {}");

    const result = await indexer.index({
      patterns: ["*.ts"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(2);
    expect(result.parsedFiles).toBe(2);
    expect(result.cachedFiles).toBe(0);
    expect(result.failedFiles).toBe(0);
    expect(result.totalEntities).toBeGreaterThanOrEqual(2);
  });

  test("returns correct entity and relationship counts", async () => {
    await writeFixture(
      "module.ts",
      `
import { helper } from "./helper";

export interface Config {
  debug: boolean;
}

export class Service {
  run() {
    helper();
  }
}

export function main() {
  const svc = new Service();
  svc.run();
}
`
    );

    const result = await indexer.index({
      patterns: ["module.ts"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(1);
    expect(result.totalEntities).toBeGreaterThanOrEqual(3); // Config, Service, main
    expect(result.totalRelationships).toBeGreaterThanOrEqual(1); // import
  });

  test("is idempotent - second run uses cache", async () => {
    await writeFixture("cached.ts", "export function cached() {}");

    // First run - should parse
    const result1 = await indexer.index({
      patterns: ["cached.ts"],
      cwd: fixtureDir,
    });

    expect(result1.parsedFiles).toBe(1);
    expect(result1.cachedFiles).toBe(0);

    // Second run - should use cache
    const result2 = await indexer.index({
      patterns: ["cached.ts"],
      cwd: fixtureDir,
    });

    expect(result2.parsedFiles).toBe(0);
    expect(result2.cachedFiles).toBe(1);
    expect(result2.totalEntities).toBe(result1.totalEntities);
  });

  test("handles file read errors gracefully", async () => {
    const result = await indexer.index({
      patterns: ["nonexistent.ts"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(1);
    expect(result.failedFiles).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toContain("nonexistent.ts");
  });

  test("progress callback receives correct data", async () => {
    await writeFixture("p1.ts", "export const a = 1;");
    await writeFixture("p2.ts", "export const b = 2;");

    const progressUpdates: IndexProgress[] = [];

    await indexer.index({
      patterns: ["*.ts"],
      cwd: fixtureDir,
      onProgress: (progress) => {
        progressUpdates.push({ ...progress });
      },
    });

    expect(progressUpdates).toHaveLength(2);
    expect(progressUpdates[0].index).toBe(0);
    expect(progressUpdates[0].total).toBe(2);
    expect(progressUpdates[0].cached).toBe(false);
    expect(progressUpdates[1].index).toBe(1);
    expect(progressUpdates[1].total).toBe(2);
  });

  test("progress callback shows cached status on re-index", async () => {
    await writeFixture("reindex.ts", "export const x = 1;");

    // First index
    await indexer.index({
      patterns: ["reindex.ts"],
      cwd: fixtureDir,
    });

    // Second index with progress tracking
    const progressUpdates: IndexProgress[] = [];
    await indexer.index({
      patterns: ["reindex.ts"],
      cwd: fixtureDir,
      onProgress: (progress) => {
        progressUpdates.push({ ...progress });
      },
    });

    expect(progressUpdates).toHaveLength(1);
    expect(progressUpdates[0].cached).toBe(true);
  });

  test("cwd option affects glob resolution", async () => {
    const subDir = join(fixtureDir, "subdir");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, "inner.ts"), "export const inner = 1;");
    await writeFile(join(fixtureDir, "outer.ts"), "export const outer = 1;");

    // Index only from subdir
    const result = await indexer.index({
      patterns: ["*.ts"],
      cwd: subDir,
    });

    expect(result.totalFiles).toBe(1);
  });

  test("empty pattern array returns zero counts", async () => {
    const result = await indexer.index({
      patterns: [],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(0);
    expect(result.parsedFiles).toBe(0);
    expect(result.cachedFiles).toBe(0);
    expect(result.totalEntities).toBe(0);
  });

  test("handles multiple glob patterns", async () => {
    await writeFixture("file.ts", "export const ts = 1;");
    await writeFixture("file.js", "export const js = 1;");
    await writeFixture("file.vue", "<script setup>const vue = 1;</script>");

    const result = await indexer.index({
      patterns: ["*.ts", "*.js"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(2);
  });

  test("deduplicates files from overlapping patterns", async () => {
    await writeFixture("dup.ts", "export const dup = 1;");

    const result = await indexer.index({
      patterns: ["*.ts", "dup.ts"],
      cwd: fixtureDir,
    });

    expect(result.totalFiles).toBe(1);
  });

  test("tracks total time", async () => {
    await writeFixture("timed.ts", "export const timed = 1;");

    const result = await indexer.index({
      patterns: ["timed.ts"],
      cwd: fixtureDir,
    });

    expect(result.totalTime).toBeGreaterThan(0);
  });
});
