import {
  type RecoveryPlan,
  type WorkflowAction,
  type WorkflowCommit,
  WorkflowManager,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowStatus,
} from "./workflow.ts";

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
   * Get the underlying WorkflowManager for shared access.
   */
  getManager(): WorkflowManager {
    return this.manager;
  }

  /**
   * Get all MCP tool definitions
   */
  getTools(): MCPTool[] {
    return [
      {
        name: "c-find",
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
        name: "c-update",
        description:
          "Update workflow checkpoint with new context, decisions, or blockers",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Workflow ID",
            },
            phase: {
              type: "string",
              enum: [
                "research",
                "implement",
                "review",
                "finalize",
                "planning",
                "execute",
                "merge",
                "cleanup",
                "completed",
              ],
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
            status: {
              type: "string",
              enum: ["running", "paused", "completed", "failed"],
              description: "Workflow status",
            },
            branch: {
              type: "string",
              description: "Git branch name",
            },
            worktree: {
              type: "string",
              description: "Git worktree path",
            },
            taskId: {
              type: "string",
              description: "Associated task ID",
            },
            logAction: {
              type: "object",
              description: "Action to log",
              properties: {
                action: { type: "string", description: "Action description" },
                result: {
                  type: "string",
                  enum: ["success", "failed", "pending"],
                  description: "Action result",
                },
                metadata: { type: "object", description: "Optional metadata" },
              },
              required: ["action", "result"],
            },
            logCommit: {
              type: "object",
              description: "Commit to log",
              properties: {
                sha: { type: "string", description: "Commit SHA" },
                message: { type: "string", description: "Commit message" },
              },
              required: ["sha", "message"],
            },
          },
          required: ["id"],
        },
      },
      {
        name: "c-complete",
        description:
          "Mark workflow as completed and optionally delete checkpoint",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Workflow ID",
            },
            delete: {
              type: "boolean",
              description:
                "Delete checkpoint file after completion (default: true)",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "c-recover",
        description:
          "Recover workflow state and build resume plan after interruption",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Workflow ID",
            },
            issue: {
              type: "number",
              description: "GitHub issue number",
            },
          },
        },
      },
    ];
  }

  /**
   * Handle MCP tool call
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    switch (name) {
      case "c-find":
        return this.handleFind(args);
      case "c-update":
        return this.handleUpdate(args);
      case "c-complete":
        return this.handleComplete(args);
      case "c-recover":
        return this.handleRecover(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleFind(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
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
        content: [
          {
            type: "text",
            text: JSON.stringify(workflows, null, 2),
          },
        ],
      };
    }

    if (!workflow) {
      return {
        content: [
          {
            type: "text",
            text: "Workflow not found",
          },
        ],
      };
    }

    const response = {
      ...workflow,
      actionCount: workflow.actions?.length ?? 0,
      commitCount: workflow.commits?.length ?? 0,
      recentActions: (workflow.actions ?? []).slice(-5),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async handleUpdate(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const {
      id,
      phase,
      context,
      decisions,
      blockers,
      status,
      branch,
      worktree,
      taskId,
      logAction,
      logCommit,
    } = args as {
      id: string;
      phase?: WorkflowPhase;
      context?: string[];
      decisions?: string[];
      blockers?: string[];
      status?: WorkflowStatus;
      branch?: string;
      worktree?: string;
      taskId?: string;
      logAction?: {
        action: string;
        result: "success" | "failed" | "pending";
        metadata?: Record<string, unknown>;
      };
      logCommit?: { sha: string; message: string };
    };

    // Add timestamps to action/commit if provided
    const now = new Date().toISOString();
    const actionWithTimestamp: WorkflowAction | undefined = logAction
      ? { ...logAction, timestamp: now }
      : undefined;
    const commitWithTimestamp: WorkflowCommit | undefined = logCommit
      ? { ...logCommit, timestamp: now }
      : undefined;

    const workflow = await this.manager.update(id, {
      phase,
      context,
      decisions,
      blockers,
      status,
      branch,
      worktree,
      taskId,
      logAction: actionWithTimestamp,
      logCommit: commitWithTimestamp,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(workflow, null, 2),
        },
      ],
    };
  }

  private async handleComplete(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { id, delete: shouldDelete = true } = args as {
      id: string;
      delete?: boolean;
    };

    await this.manager.complete(id, shouldDelete);

    return {
      content: [
        {
          type: "text",
          text: `Workflow ${id} completed${shouldDelete ? " and deleted" : ""}`,
        },
      ],
    };
  }

  private async handleRecover(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { issue, id } = args as { issue?: number; id?: string };

    let workflowId = id;

    if (!workflowId && issue !== undefined) {
      const workflow = await this.manager.findByIssue(issue);
      if (workflow) {
        workflowId = workflow.id;
      }
    }

    if (!workflowId) {
      return {
        content: [
          {
            type: "text",
            text: "Workflow not found. Provide either an id or issue number.",
          },
        ],
      };
    }

    const plan = await this.manager.recover(workflowId);
    if (!plan) {
      return {
        content: [
          {
            type: "text",
            text: `No workflow found for id: ${workflowId}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(plan, null, 2),
        },
      ],
    };
  }
}
