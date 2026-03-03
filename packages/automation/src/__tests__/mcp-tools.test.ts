import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { PlanningMCPTools } from "@graph-flow/planning";
import { AutomationMCPTools } from "../mcp-tools";

const TEST_PLANNING_DIR = "/tmp/graph-flow-test-automation-mcp-planning";

describe("AutomationMCPTools", () => {
  let planning: PlanningMCPTools;
  let automation: AutomationMCPTools;

  beforeEach(async () => {
    planning = new PlanningMCPTools(TEST_PLANNING_DIR);
    await planning.init();

    automation = new AutomationMCPTools(planning.getManager());
    await automation.init();
  });

  afterEach(async () => {
    await rm(TEST_PLANNING_DIR, { recursive: true, force: true });
  });

  test("provides 3 tools", () => {
    const tools = automation.getTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "a-import",
      "a-create-issue",
      "a-board-update",
    ]);
  });

  test("all tools have a- prefix", () => {
    const tools = automation.getTools();
    for (const tool of tools) {
      expect(tool.name).toStartWith("a-");
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
    await expect(automation.handleToolCall("a-unknown", {})).rejects.toThrow(
      "Unknown tool: a-unknown",
    );
  });

  test("tool names are unique and don't clash with other subsystems", () => {
    const automationNames = automation.getTools().map((t) => t.name);
    const planningNames = planning.getTools().map((t) => t.name);

    const allNames = [...automationNames, ...planningNames];
    const uniqueNames = new Set(allNames);

    expect(allNames.length).toBe(uniqueNames.size);
  });
});
