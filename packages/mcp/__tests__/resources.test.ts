import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { GraphFlowServer } from "../src/index.ts";

const TEST_BASE_DIR = "/tmp/graph-flow-test-mcp-resources";

describe("MCP Resources", () => {
  let server: GraphFlowServer;

  beforeEach(async () => {
    server = new GraphFlowServer({ baseDir: TEST_BASE_DIR });
    await server.init();
  });

  afterEach(async () => {
    await server.close();
    await rm(TEST_BASE_DIR, { recursive: true, force: true });
  });

  test("list resources includes checkpoint and knowledge", () => {
    const result = server.listResourcesForTests();
    const uris = result.resources.map((r) => r.uri);
    expect(uris).toContain("checkpoint://workflows");
    expect(uris).toContain("knowledge://learnings");
  });

  test("read checkpoint workflows returns json list", async () => {
    const result = await server.readResourceForTests("checkpoint://workflows");
    const text = result.contents[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("read knowledge learnings base URI returns json list", async () => {
    const result = await server.readResourceForTests("knowledge://learnings");
    const text = result.contents[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("read knowledge learnings with area returns json list", async () => {
    const result = await server.readResourceForTests(
      "knowledge://learnings/auth",
    );
    const text = result.contents[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
