import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { JSONLStorage } from "../src/storage.ts";
import { rm } from "node:fs/promises";

const TEST_DIR = "/tmp/graph-flow-test-storage";

describe("JSONLStorage", () => {
  let storage: JSONLStorage;

  beforeEach(async () => {
    storage = new JSONLStorage({ baseDir: TEST_DIR });
    await storage.init();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("should write and read JSONL file", async () => {
    const records = [
      { timestamp: "2024-01-01T00:00:00Z", data: "test1" },
      { timestamp: "2024-01-01T00:00:01Z", data: "test2" },
    ];

    await storage.write("test.jsonl", records);
    const read = await storage.read("test.jsonl");

    expect(read).toEqual(records);
  });

  test("should append to JSONL file", async () => {
    await storage.write("test.jsonl", [
      { timestamp: "2024-01-01T00:00:00Z", data: "test1" },
    ]);

    await storage.append("test.jsonl", {
      timestamp: "2024-01-01T00:00:01Z",
      data: "test2",
    });

    const read = await storage.read("test.jsonl");
    expect(read).toHaveLength(2);
    expect(read[1].data).toBe("test2");
  });

  test("should list JSONL files", async () => {
    await storage.write("test1.jsonl", [{ timestamp: "2024-01-01T00:00:00Z" }]);
    await storage.write("test2.jsonl", [{ timestamp: "2024-01-01T00:00:00Z" }]);

    const files = await storage.list();
    expect(files).toContain("test1.jsonl");
    expect(files).toContain("test2.jsonl");
  });

  test("should delete JSONL file", async () => {
    await storage.write("test.jsonl", [{ timestamp: "2024-01-01T00:00:00Z" }]);
    expect(storage.exists("test.jsonl")).toBe(true);

    await storage.delete("test.jsonl");
    expect(storage.exists("test.jsonl")).toBe(false);
  });

  test("should handle empty files", async () => {
    const read = await storage.read("nonexistent.jsonl");
    expect(read).toEqual([]);
  });
});
