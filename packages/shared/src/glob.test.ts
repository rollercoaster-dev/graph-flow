import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { expandGlobs } from "./glob";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_DIR = join(import.meta.dir, "__test_glob_fixtures__");

beforeAll(() => {
  // Create fixture tree
  mkdirSync(join(TEST_DIR, "src"), { recursive: true });
  mkdirSync(join(TEST_DIR, "dist"), { recursive: true });
  mkdirSync(join(TEST_DIR, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(TEST_DIR, "lib"), { recursive: true });

  writeFileSync(join(TEST_DIR, "src", "index.ts"), "export {}");
  writeFileSync(join(TEST_DIR, "src", "utils.ts"), "export {}");
  writeFileSync(join(TEST_DIR, "dist", "index.js"), "");
  writeFileSync(join(TEST_DIR, "node_modules", "pkg", "index.js"), "");
  writeFileSync(join(TEST_DIR, "lib", "helper.ts"), "export {}");
  writeFileSync(join(TEST_DIR, "debug.log"), "");
  writeFileSync(join(TEST_DIR, "app.ts"), "export {}");

  // .gitignore that mirrors common patterns
  writeFileSync(
    join(TEST_DIR, ".gitignore"),
    ["node_modules/", "dist/", "*.log", ""].join("\n")
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("expandGlobs", () => {
  it("always excludes node_modules (hard-coded exclusion)", async () => {
    const results = await expandGlobs(["**/*.ts"], TEST_DIR);
    const hasNodeModules = results.some((f) => f.includes("node_modules"));
    expect(hasNodeModules).toBe(false);
  });

  it("excludes dist/ (directory pattern from .gitignore)", async () => {
    const results = await expandGlobs(["**/*.js"], TEST_DIR);
    const hasDist = results.some((f) => f.includes("/dist/"));
    expect(hasDist).toBe(false);
  });

  it("excludes *.log (file pattern from .gitignore)", async () => {
    const results = await expandGlobs(["**/*"], TEST_DIR);
    const hasLog = results.some((f) => f.endsWith(".log"));
    expect(hasLog).toBe(false);
  });

  it("includes files not matched by .gitignore", async () => {
    const results = await expandGlobs(["**/*.ts"], TEST_DIR);
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.some((f) => f.endsWith("src/index.ts"))).toBe(true);
    expect(results.some((f) => f.endsWith("src/utils.ts"))).toBe(true);
    expect(results.some((f) => f.endsWith("lib/helper.ts"))).toBe(true);
  });

  it("filters non-glob literal paths through gitignore", async () => {
    const results = await expandGlobs(
      ["node_modules/pkg/index.js"],
      TEST_DIR
    );
    expect(results).toEqual([]);
  });

  it("deduplicates results", async () => {
    const results = await expandGlobs(["src/*.ts", "src/*.ts"], TEST_DIR);
    const unique = [...new Set(results)];
    expect(results.length).toBe(unique.length);
  });

  it("works when no .gitignore exists (still excludes node_modules)", async () => {
    // lib/ has no .gitignore
    const results = await expandGlobs(["*.ts"], join(TEST_DIR, "lib"));
    expect(results.some((f) => f.endsWith("helper.ts"))).toBe(true);
  });
});
