import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { PlanningMCPTools } from "@graph-flow/planning";
import { CheckpointMCPTools } from "@graph-flow/checkpoint";
import { AutomationMCPTools } from "../mcp-tools";

const TEST_PLANNING_DIR = "/tmp/graph-flow-test-automation-mcp-planning";
const TEST_WORKFLOWS_DIR = "/tmp/graph-flow-test-automation-mcp-workflows";

describe("AutomationMCPTools", () => {
  let planning: PlanningMCPTools;
  let checkpoint: CheckpointMCPTools;
  let automation: AutomationMCPTools;

  beforeEach(async () => {
    planning = new PlanningMCPTools(TEST_PLANNING_DIR);
    checkpoint = new CheckpointMCPTools(TEST_WORKFLOWS_DIR);
    await planning.init();
    await checkpoint.init();

    automation = new AutomationMCPTools(
      planning.getManager(),
      checkpoint.getManager()
    );
    await automation.init();
  });

  afterEach(async () => {
    await rm(TEST_PLANNING_DIR, { recursive: true, force: true });
    await rm(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
  });

  test("provides 4 tools", () => {
    const tools = automation.getTools();
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name)).toEqual([
      "automation-from-milestone",
      "automation-from-epic",
      "automation-create-issue",
      "automation-start-issue",
    ]);
  });

  test("all tools have automation- prefix", () => {
    const tools = automation.getTools();
    for (const tool of tools) {
      expect(tool.name).toStartWith("automation-");
    }
  });

  test("all tools have required inputSchema", () => {
    const tools = automation.getTools();
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  test("handleToolCall throws for unknown tool", async () => {
    await expect(
      automation.handleToolCall("automation-unknown", {})
    ).rejects.toThrow("Unknown tool: automation-unknown");
  });

  test("tool names are unique and don't clash with other subsystems", () => {
    const automationNames = automation.getTools().map((t) => t.name);
    const planningNames = planning.getTools().map((t) => t.name);
    const checkpointNames = checkpoint.getTools().map((t) => t.name);

    const allNames = [...automationNames, ...planningNames, ...checkpointNames];
    const uniqueNames = new Set(allNames);

    expect(allNames.length).toBe(uniqueNames.size);
  });
});
