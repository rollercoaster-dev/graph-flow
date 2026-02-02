import { WorkflowManager, type WorkflowState, type WorkflowPhase } from "./workflow.ts";

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

/**
 * MCP tools for checkpoint/workflow operations
 */
export class CheckpointMCPTools {
  private manager: WorkflowManager;

  constructor(storageDir: string) {
    this.manager = new WorkflowManager(storageDir);
  }

  async init(): Promise<void> {
    await this.manager.init();
  }

  /**
   * Get all MCP tool definitions
   */
  getTools(): MCPTool[] {
    return [
      {
        name: "checkpoint-find",
        description: "Find workflow checkpoint by issue number or ID",
        inputSchema: {
          type: "object",
          properties: {
            issue: {
              type: "number",
              description: "GitHub issue number",
            },
            id: {
              type: "string",
              description: "Workflow ID",
            },
          },
        },
      },
      {
        name: "checkpoint-update",
        description: "Update workflow checkpoint with new context, decisions, or blockers",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Workflow ID",
            },
            phase: {
              type: "string",
              enum: ["research", "implement", "review", "finalize", "completed"],
              description: "Current workflow phase",
            },
            context: {
              type: "array",
              items: { type: "string" },
              description: "Context items to add",
            },
            decisions: {
              type: "array",
              items: { type: "string" },
              description: "Decisions made",
            },
            blockers: {
              type: "array",
              items: { type: "string" },
              description: "Blockers encountered",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "checkpoint-complete",
        description: "Mark workflow as completed and optionally delete checkpoint",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Workflow ID",
            },
            delete: {
              type: "boolean",
              description: "Delete checkpoint file after completion (default: true)",
            },
          },
          required: ["id"],
        },
      },
    ];
  }

  /**
   * Handle MCP tool call
   */
  async handleToolCall(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    switch (name) {
      case "checkpoint-find":
        return this.handleFind(args);
      case "checkpoint-update":
        return this.handleUpdate(args);
      case "checkpoint-complete":
        return this.handleComplete(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleFind(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { issue, id } = args as { issue?: number; id?: string };

    let workflow: WorkflowState | null = null;

    if (issue !== undefined) {
      workflow = await this.manager.findByIssue(issue);
    } else if (id) {
      workflow = await this.manager.get(id);
    } else {
      // List all workflows
      const workflows = await this.manager.list();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(workflows, null, 2),
        }],
      };
    }

    if (!workflow) {
      return {
        content: [{
          type: "text",
          text: "Workflow not found",
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(workflow, null, 2),
      }],
    };
  }

  private async handleUpdate(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { id, phase, context, decisions, blockers } = args as {
      id: string;
      phase?: WorkflowPhase;
      context?: string[];
      decisions?: string[];
      blockers?: string[];
    };

    const workflow = await this.manager.update(id, {
      phase,
      context,
      decisions,
      blockers,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(workflow, null, 2),
      }],
    };
  }

  private async handleComplete(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { id, delete: shouldDelete = true } = args as {
      id: string;
      delete?: boolean;
    };

    await this.manager.complete(id, shouldDelete);

    return {
      content: [{
        type: "text",
        text: `Workflow ${id} completed${shouldDelete ? " and deleted" : ""}`,
      }],
    };
  }
}
