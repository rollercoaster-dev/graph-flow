import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatInitResult, runInit } from "../src/init.ts";

describe("runInit", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "graph-flow-init-test-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  test("creates data directories", async () => {
    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: false,
    });

    expect(result.dataDir).toBe(join(projectDir, ".claude"));
    expect(result.healthCheck.dataDir.exists).toBe(true);
    expect(result.healthCheck.dataDir.writable).toBe(true);
  });

  test("returns correct project root", async () => {
    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: false,
    });

    expect(result.projectRoot).toBe(projectDir);
  });

  test("generates MCP config with project path", async () => {
    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: false,
    });

    const config = result.mcpConfig as {
      mcpServers: { "graph-flow": { env: { CLAUDE_PROJECT_DIR: string } } };
    };
    expect(config.mcpServers["graph-flow"].env.CLAUDE_PROJECT_DIR).toBe(
      projectDir,
    );
  });

  test("indexes code files when indexCode is true", async () => {
    // Create a source file
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(
      join(projectDir, "src", "main.ts"),
      "export function main() { console.log('hello'); }",
    );

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: true,
      indexDocs: false,
    });

    expect(result.codeIndexResult).toBeDefined();
    expect(result.codeIndexResult?.totalFiles).toBeGreaterThanOrEqual(1);
  });

  test("skips code indexing when indexCode is false", async () => {
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(
      join(projectDir, "src", "main.ts"),
      "export function main() {}",
    );

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: false,
    });

    expect(result.codeIndexResult).toBeUndefined();
  });

  test("indexes docs files when indexDocs is true", async () => {
    // Create a docs file
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await writeFile(
      join(projectDir, "docs", "guide.md"),
      "# Guide\n\nThis is a guide with enough content to be indexed properly.",
    );

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: true,
    });

    expect(result.docsIndexResult).toBeDefined();
    expect(result.docsIndexResult?.totalFiles).toBeGreaterThanOrEqual(1);
  });

  test("skips docs indexing when indexDocs is false", async () => {
    await writeFile(join(projectDir, "README.md"), "# Project\n\nDescription.");

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: false,
    });

    expect(result.docsIndexResult).toBeUndefined();
  });

  test("uses custom code patterns when provided", async () => {
    // Create files in non-standard location
    await mkdir(join(projectDir, "custom"), { recursive: true });
    await writeFile(
      join(projectDir, "custom", "code.ts"),
      "export const x = 1;",
    );

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: true,
      indexDocs: false,
      codePatterns: ["custom/**/*.ts"],
    });

    expect(result.codeIndexResult).toBeDefined();
    expect(result.codeIndexResult?.totalFiles).toBe(1);
  });

  test("uses custom docs patterns when provided", async () => {
    // Create files in non-standard location
    await mkdir(join(projectDir, "notes"), { recursive: true });
    await writeFile(
      join(projectDir, "notes", "info.md"),
      "# Notes\n\nSome notes with enough content to be indexed.",
    );

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: true,
      docsPatterns: ["notes/**/*.md"],
    });

    expect(result.docsIndexResult).toBeDefined();
    expect(result.docsIndexResult?.totalFiles).toBe(1);
  });

  test("auto-detects src directory for code patterns", async () => {
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "src", "app.ts"), "export class App {}");

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: true,
      indexDocs: false,
    });

    expect(result.codeIndexResult).toBeDefined();
    expect(result.codeIndexResult?.totalFiles).toBeGreaterThanOrEqual(1);
  });

  test("auto-detects docs directory for docs patterns", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await writeFile(
      join(projectDir, "docs", "api.md"),
      "# API\n\nAPI documentation with enough content to be indexed.",
    );

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: false,
      indexDocs: true,
    });

    expect(result.docsIndexResult).toBeDefined();
    expect(result.docsIndexResult?.totalFiles).toBeGreaterThanOrEqual(1);
  });

  test("handles empty project gracefully", async () => {
    const result = await runInit({
      projectRoot: projectDir,
      indexCode: true,
      indexDocs: true,
    });

    // Should not throw, just have zero results
    expect(result.projectRoot).toBe(projectDir);
    expect(result.healthCheck.dataDir.exists).toBe(true);
  });

  test("health check counts files correctly after indexing", async () => {
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(
      join(projectDir, "src", "util.ts"),
      "export function util() {}",
    );

    const result = await runInit({
      projectRoot: projectDir,
      indexCode: true,
      indexDocs: false,
    });

    // After indexing, graphs directory should have files
    expect(result.healthCheck.graphs.files).toBeGreaterThanOrEqual(1);
  });
});

describe("formatInitResult", () => {
  test("formats result with code indexing", () => {
    const result = {
      projectRoot: "/test/project",
      dataDir: "/test/project/.claude",
      mcpConfig: { mcpServers: {} },
      codeIndexResult: {
        totalFiles: 10,
        parsedFiles: 8,
        cachedFiles: 2,
        failedFiles: 0,
        totalEntities: 50,
        totalRelationships: 30,
        totalTime: 1234,
        errors: [],
      },
      healthCheck: {
        dataDir: { exists: true, writable: true },
        graphs: { files: 10 },
        learnings: { files: 0, areas: [] },
        embeddings: { files: 0 },
        workflows: { files: 0 },
        planning: { files: 0 },
      },
    };

    const output = formatInitResult(result);

    expect(output).toContain("graph-flow initialized successfully!");
    expect(output).toContain("/test/project");
    expect(output).toContain("Code indexing:");
    expect(output).toContain("Files: 10 (8 parsed, 2 cached)");
    expect(output).toContain("Entities: 50");
    expect(output).toContain("Relationships: 30");
  });

  test("formats result with docs indexing", () => {
    const result = {
      projectRoot: "/test/project",
      dataDir: "/test/project/.claude",
      mcpConfig: { mcpServers: {} },
      docsIndexResult: {
        totalFiles: 5,
        totalSections: 15,
        totalLearnings: 12,
        skippedDuplicates: 3,
        totalTime: 567,
        learningsByArea: { api: 5, auth: 7 },
        errors: [],
      },
      healthCheck: {
        dataDir: { exists: true, writable: true },
        graphs: { files: 0 },
        learnings: { files: 12, areas: ["api", "auth"] },
        embeddings: { files: 12 },
        workflows: { files: 0 },
        planning: { files: 0 },
      },
    };

    const output = formatInitResult(result);

    expect(output).toContain("Docs indexing:");
    expect(output).toContain("Files: 5");
    expect(output).toContain("Sections: 15");
    expect(output).toContain("Learnings: 12");
    expect(output).toContain("Skipped duplicates: 3");
    expect(output).toContain("Areas: api, auth");
  });

  test("formats result without indexing", () => {
    const result = {
      projectRoot: "/test/project",
      dataDir: "/test/project/.claude",
      mcpConfig: { mcpServers: { "graph-flow": { command: "bunx" } } },
      healthCheck: {
        dataDir: { exists: true, writable: true },
        graphs: { files: 0 },
        learnings: { files: 0, areas: [] },
        embeddings: { files: 0 },
        workflows: { files: 0 },
        planning: { files: 0 },
      },
    };

    const output = formatInitResult(result);

    expect(output).toContain("graph-flow initialized successfully!");
    expect(output).not.toContain("Code indexing:");
    expect(output).not.toContain("Docs indexing:");
    expect(output).toContain("Health check:");
    expect(output).toContain("MCP Configuration");
  });

  test("includes failed files count when present", () => {
    const result = {
      projectRoot: "/test/project",
      dataDir: "/test/project/.claude",
      mcpConfig: { mcpServers: {} },
      codeIndexResult: {
        totalFiles: 10,
        parsedFiles: 8,
        cachedFiles: 0,
        failedFiles: 2,
        totalEntities: 50,
        totalRelationships: 30,
        totalTime: 1234,
        errors: [{ file: "bad.ts", error: "parse error" }],
      },
      healthCheck: {
        dataDir: { exists: true, writable: true },
        graphs: { files: 8 },
        learnings: { files: 0, areas: [] },
        embeddings: { files: 0 },
        workflows: { files: 0 },
        planning: { files: 0 },
      },
    };

    const output = formatInitResult(result);

    expect(output).toContain("Failed: 2");
  });
});
