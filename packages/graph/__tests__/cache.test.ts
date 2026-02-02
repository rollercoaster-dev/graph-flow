import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GraphCache } from "../src/cache.ts";
import { rm } from "node:fs/promises";

const TEST_DIR = "/tmp/graph-flow-test-cache";

describe("GraphCache", () => {
  let cache: GraphCache;

  beforeEach(async () => {
    cache = new GraphCache(TEST_DIR);
    await cache.init();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("should generate consistent hash for content", () => {
    const content = "function test() { return 42; }";
    const hash1 = cache.hashContent(content);
    const hash2 = cache.hashContent(content);
    expect(hash1).toBe(hash2);
  });

  test("should generate different hash for different content", () => {
    const content1 = "function test() { return 42; }";
    const content2 = "function test() { return 43; }";
    const hash1 = cache.hashContent(content1);
    const hash2 = cache.hashContent(content2);
    expect(hash1).not.toBe(hash2);
  });

  test("should write and read cached graph data", async () => {
    const filepath = "src/test.ts";
    const content = "function test() {}";
    const data = {
      entities: [
        {
          name: "test",
          type: "function" as const,
          location: { file: filepath, line: 1 },
        },
      ],
      relationships: [],
    };

    await cache.write(filepath, content, data);
    const cached = await cache.read(filepath, content);

    expect(cached).not.toBeNull();
    expect(cached?.entities).toHaveLength(1);
    expect(cached?.entities[0].name).toBe("test");
  });

  test("should return null for cache miss", async () => {
    const filepath = "src/test.ts";
    const content = "function test() {}";
    const cached = await cache.read(filepath, content);
    expect(cached).toBeNull();
  });

  test("should invalidate cache when content changes", async () => {
    const filepath = "src/test.ts";
    const content1 = "function test() { return 1; }";
    const content2 = "function test() { return 2; }";

    const data = {
      entities: [
        {
          name: "test",
          type: "function" as const,
          location: { file: filepath, line: 1 },
        },
      ],
      relationships: [],
    };

    await cache.write(filepath, content1, data);

    // Cache miss with different content
    const cached = await cache.read(filepath, content2);
    expect(cached).toBeNull();
  });
});
