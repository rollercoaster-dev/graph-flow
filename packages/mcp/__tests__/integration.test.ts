import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { CheckpointMCPTools } from "@graph-flow/checkpoint";
import { DocsMCPTools } from "@graph-flow/docs";
import { GraphMCPTools } from "@graph-flow/graph";
import { KnowledgeMCPTools } from "@graph-flow/knowledge";

const TEST_WORKFLOWS_DIR = "/tmp/graph-flow-test-mcp-workflows";
const TEST_LEARNINGS_DIR = "/tmp/graph-flow-test-mcp-learnings";
const TEST_EMBEDDINGS_DIR = "/tmp/graph-flow-test-mcp-embeddings";
const TEST_GRAPHS_DIR = "/tmp/graph-flow-test-mcp-graphs";
const TEST_DOCS_DIR = "/tmp/graph-flow-test-mcp-docs";

describe("MCP Integration", () => {
  test("checkpoint tools initialize and respond", async () => {
    const checkpoint = new CheckpointMCPTools(TEST_WORKFLOWS_DIR);
    await checkpoint.init();

    const tools = checkpoint.getTools();
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name)).toContain("c-find");
    expect(tools.map((t) => t.name)).toContain("c-recover");

    // Clean up
    await rm(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
  });

  test("knowledge tools initialize and respond", async () => {
    const knowledge = new KnowledgeMCPTools(
      TEST_LEARNINGS_DIR,
      TEST_EMBEDDINGS_DIR,
    );
    await knowledge.init();

    const tools = knowledge.getTools();
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name)).toContain("k-query");
    expect(tools.map((t) => t.name)).toContain("k-index");

    // Clean up
    await rm(TEST_LEARNINGS_DIR, { recursive: true, force: true });
    await rm(TEST_EMBEDDINGS_DIR, { recursive: true, force: true });
  });

  test("graph tools initialize and respond", async () => {
    const graph = new GraphMCPTools(TEST_GRAPHS_DIR);
    await graph.init();

    const tools = graph.getTools();
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name)).toContain("g-calls");
    expect(tools.map((t) => t.name)).toContain("g-blast");
    expect(tools.map((t) => t.name)).toContain("g-defs");
    expect(tools.map((t) => t.name)).toContain("g-index");

    // Clean up
    await rm(TEST_GRAPHS_DIR, { recursive: true, force: true });
  });

  test("docs tools initialize and respond", async () => {
    const docs = new DocsMCPTools(TEST_DOCS_DIR, TEST_EMBEDDINGS_DIR);
    await docs.init();

    const tools = docs.getTools();
    expect(tools.length).toBe(3);
    expect(tools.map((t) => t.name)).toContain("d-index");
    expect(tools.map((t) => t.name)).toContain("d-query");
    expect(tools.map((t) => t.name)).toContain("d-for-code");

    // Clean up
    await rm(TEST_DOCS_DIR, { recursive: true, force: true });
  });

  test("all tools have unique names", async () => {
    const checkpoint = new CheckpointMCPTools(TEST_WORKFLOWS_DIR);
    const knowledge = new KnowledgeMCPTools(
      TEST_LEARNINGS_DIR,
      TEST_EMBEDDINGS_DIR,
    );
    const graph = new GraphMCPTools(TEST_GRAPHS_DIR);
    const docs = new DocsMCPTools(TEST_DOCS_DIR, TEST_EMBEDDINGS_DIR);

    await checkpoint.init();
    await knowledge.init();
    await graph.init();
    await docs.init();

    const allTools = [
      ...checkpoint.getTools(),
      ...knowledge.getTools(),
      ...graph.getTools(),
      ...docs.getTools(),
    ];

    const names = allTools.map((t) => t.name);
    const uniqueNames = new Set(names);

    expect(names.length).toBe(uniqueNames.size);
    expect(names.length).toBe(15); // 4 checkpoint + 4 knowledge + 4 graph + 3 docs

    // Clean up
    await rm(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
    await rm(TEST_LEARNINGS_DIR, { recursive: true, force: true });
    await rm(TEST_EMBEDDINGS_DIR, { recursive: true, force: true });
    await rm(TEST_GRAPHS_DIR, { recursive: true, force: true });
    await rm(TEST_DOCS_DIR, { recursive: true, force: true });
  });
});
