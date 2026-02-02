import { describe, test, expect } from "bun:test";
import { CheckpointMCPTools } from "@graph-flow/checkpoint";
import { KnowledgeMCPTools } from "@graph-flow/knowledge";
import { GraphMCPTools } from "@graph-flow/graph";
import { rm } from "node:fs/promises";

const TEST_WORKFLOWS_DIR = "/tmp/graph-flow-test-mcp-workflows";
const TEST_LEARNINGS_DIR = "/tmp/graph-flow-test-mcp-learnings";
const TEST_GRAPHS_DIR = "/tmp/graph-flow-test-mcp-graphs";

describe("MCP Integration", () => {
  test("checkpoint tools initialize and respond", async () => {
    const checkpoint = new CheckpointMCPTools(TEST_WORKFLOWS_DIR);
    await checkpoint.init();

    const tools = checkpoint.getTools();
    expect(tools.length).toBe(3);
    expect(tools.map(t => t.name)).toContain("checkpoint-find");

    // Clean up
    await rm(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
  });

  test("knowledge tools initialize and respond", async () => {
    const knowledge = new KnowledgeMCPTools(TEST_LEARNINGS_DIR);
    await knowledge.init();

    const tools = knowledge.getTools();
    expect(tools.length).toBe(3);
    expect(tools.map(t => t.name)).toContain("knowledge-query");

    // Clean up
    await rm(TEST_LEARNINGS_DIR, { recursive: true, force: true });
  });

  test("graph tools initialize and respond", async () => {
    const graph = new GraphMCPTools(TEST_GRAPHS_DIR);
    await graph.init();

    const tools = graph.getTools();
    expect(tools.length).toBe(3);
    expect(tools.map(t => t.name)).toContain("graph-calls");

    // Clean up
    await rm(TEST_GRAPHS_DIR, { recursive: true, force: true });
  });

  test("all tools have unique names", async () => {
    const checkpoint = new CheckpointMCPTools(TEST_WORKFLOWS_DIR);
    const knowledge = new KnowledgeMCPTools(TEST_LEARNINGS_DIR);
    const graph = new GraphMCPTools(TEST_GRAPHS_DIR);

    await checkpoint.init();
    await knowledge.init();
    await graph.init();

    const allTools = [
      ...checkpoint.getTools(),
      ...knowledge.getTools(),
      ...graph.getTools(),
    ];

    const names = allTools.map(t => t.name);
    const uniqueNames = new Set(names);

    expect(names.length).toBe(uniqueNames.size);
    expect(names.length).toBe(9); // 3 per subsystem

    // Clean up
    await rm(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
    await rm(TEST_LEARNINGS_DIR, { recursive: true, force: true });
    await rm(TEST_GRAPHS_DIR, { recursive: true, force: true });
  });
});
