/**
 * Automation MCP Tools
 *
 * 3 tools: a-import, a-create-issue, a-board-update
 *
 * Changes in v3:
 * - Merged a-from-milestone/a-from-epic into a-import { type, number }
 * - Removed a-start-issue (setup skill handles this via p-goal + c-update)
 * - Added a-board-update for GitHub Project board operations
 */

import type { PlanningManager } from "@graph-flow/planning/manager";
import { AutomationOrchestrator } from "./orchestrator";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export class AutomationMCPTools {
  private orchestrator: AutomationOrchestrator;

  constructor(planning: PlanningManager) {
    this.orchestrator = new AutomationOrchestrator(planning);
  }

  async init(): Promise<void> {
    // No async initialization needed; managers are already initialized
  }

  getTools(): MCPTool[] {
    return [
      {
        name: "a-import",
        description:
          "Import a GitHub milestone or epic into the planning stack. Creates a Goal, Plan, and Steps (one per issue/sub-issue).",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["milestone", "epic"],
              description: "Type of entity to import",
            },
            number: {
              type: "number",
              description: "GitHub milestone number or epic issue number",
            },
          },
          required: ["type", "number"],
        },
      },
      {
        name: "a-create-issue",
        description:
          "Create a new GitHub issue, optionally linking it as a PlanStep in an existing plan.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Issue title",
            },
            body: {
              type: "string",
              description: "Issue body (markdown)",
            },
            labels: {
              type: "array",
              items: { type: "string" },
              description: "Labels to apply",
            },
            milestone: {
              type: "number",
              description: "Milestone number to assign to",
            },
            planId: {
              type: "string",
              description: "Plan ID to link the new issue as a step",
            },
          },
          required: ["title"],
        },
      },
      {
        name: "a-board-update",
        description:
          "Update a GitHub Project board item's status. Adds the issue to the board if not already present.",
        inputSchema: {
          type: "object",
          properties: {
            issueNumber: {
              type: "number",
              description: "GitHub issue number",
            },
            status: {
              type: "string",
              enum: ["Backlog", "Next", "In Progress", "Blocked", "Done"],
              description: "Board status to set",
            },
          },
          required: ["issueNumber", "status"],
        },
      },
    ];
  }

  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    switch (name) {
      case "a-import":
        return this.handleImport(args);
      case "a-create-issue":
        return this.handleCreateIssue(args);
      case "a-board-update":
        return this.handleBoardUpdate(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleImport(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { type, number: num } = args as {
      type: "milestone" | "epic";
      number: number;
    };
    const result = await this.orchestrator.importSource(type, num);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  private async handleCreateIssue(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { title, body, labels, milestone, planId } = args as {
      title: string;
      body?: string;
      labels?: string[];
      milestone?: number;
      planId?: string;
    };
    const result = await this.orchestrator.createIssue({
      title,
      body,
      labels,
      milestone,
      planId,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  private async handleBoardUpdate(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { issueNumber, status } = args as {
      issueNumber: number;
      status: "Backlog" | "Next" | "In Progress" | "Blocked" | "Done";
    };
    const result = await this.orchestrator.boardUpdate(issueNumber, status);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
}
