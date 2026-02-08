/**
 * Automation MCP Tools
 *
 * MCP tool definitions and handlers for GitHub automation workflows.
 * Same pattern as PlanningMCPTools and CheckpointMCPTools.
 */

import type { PlanningManager } from "@graph-flow/planning/manager";
import type { WorkflowManager } from "@graph-flow/checkpoint/workflow";
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

  constructor(planning: PlanningManager, workflows: WorkflowManager) {
    this.orchestrator = new AutomationOrchestrator(planning, workflows);
  }

  async init(): Promise<void> {
    // No async initialization needed; managers are already initialized
  }

  getTools(): MCPTool[] {
    return [
      {
        name: "a-from-milestone",
        description:
          "Fetch a GitHub milestone and its issues via `gh`, then create a Goal, Plan, and Steps in the planning stack.",
        inputSchema: {
          type: "object",
          properties: {
            number: {
              type: "number",
              description: "GitHub milestone number",
            },
          },
          required: ["number"],
        },
      },
      {
        name: "a-from-epic",
        description:
          "Fetch a GitHub epic issue and its sub-issues, then create a Goal, Plan, and Steps in the planning stack.",
        inputSchema: {
          type: "object",
          properties: {
            number: {
              type: "number",
              description: "GitHub issue number of the epic",
            },
          },
          required: ["number"],
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
        name: "a-start-issue",
        description:
          "Start working on a GitHub issue: fetch it, create a branch, push a Goal onto the planning stack, and create a workflow checkpoint.",
        inputSchema: {
          type: "object",
          properties: {
            number: {
              type: "number",
              description: "GitHub issue number",
            },
          },
          required: ["number"],
        },
      },
    ];
  }

  async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    switch (name) {
      case "a-from-milestone":
        return this.handleFromMilestone(args);
      case "a-from-epic":
        return this.handleFromEpic(args);
      case "a-create-issue":
        return this.handleCreateIssue(args);
      case "a-start-issue":
        return this.handleStartIssue(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleFromMilestone(
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const { number: num } = args as { number: number };
    const result = await this.orchestrator.fromMilestone(num);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  private async handleFromEpic(
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const { number: num } = args as { number: number };
    const result = await this.orchestrator.fromEpic(num);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  private async handleCreateIssue(
    args: Record<string, unknown>
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

  private async handleStartIssue(
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const { number: num } = args as { number: number };
    const result = await this.orchestrator.startIssue(num);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
}
