import { LearningManager, type StoreLearningParams, type QueryParams } from "./learning.ts";

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
 * MCP tools for knowledge/learning operations
 */
export class KnowledgeMCPTools {
  private manager: LearningManager;

  constructor(storageDir: string) {
    this.manager = new LearningManager(storageDir);
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
        name: "knowledge-query",
        description: "Search learnings by text, area, or type",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Search text (TF-IDF search)",
            },
            area: {
              type: "string",
              description: "Filter by code area (e.g., 'auth', 'api')",
            },
            type: {
              type: "string",
              enum: ["entity", "relationship", "pattern", "decision"],
              description: "Filter by learning type",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 10)",
            },
          },
        },
      },
      {
        name: "knowledge-store",
        description: "Store a new learning",
        inputSchema: {
          type: "object",
          properties: {
            area: {
              type: "string",
              description: "Code area (e.g., 'auth', 'api', 'database')",
            },
            type: {
              type: "string",
              enum: ["entity", "relationship", "pattern", "decision"],
              description: "Learning type",
            },
            content: {
              type: "string",
              description: "Learning content",
            },
            metadata: {
              type: "object",
              description: "Optional metadata",
            },
          },
          required: ["area", "type", "content"],
        },
      },
      {
        name: "knowledge-related",
        description: "Find related learnings by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Learning ID",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 5)",
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
      case "knowledge-query":
        return this.handleQuery(args);
      case "knowledge-store":
        return this.handleStore(args);
      case "knowledge-related":
        return this.handleRelated(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleQuery(args: Record<string, unknown>): Promise<MCPToolResult> {
    const params = args as QueryParams;
    const learnings = await this.manager.query(params);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(learnings, null, 2),
      }],
    };
  }

  private async handleStore(args: Record<string, unknown>): Promise<MCPToolResult> {
    const params = args as StoreLearningParams;
    const learning = await this.manager.store(params);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(learning, null, 2),
      }],
    };
  }

  private async handleRelated(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { id, limit = 5 } = args as { id: string; limit?: number };
    const related = await this.manager.getRelated(id, limit);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(related, null, 2),
      }],
    };
  }
}
