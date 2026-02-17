import {
  DocsIndexer,
  type DocsIndexOptions,
  type DocsIndexResult,
} from "./docs-indexer.ts";
import {
  LearningManager,
  type LearningType,
  type QueryParams,
  type StoreLearningParams,
} from "./learning.ts";

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
  private indexer: DocsIndexer;

  constructor(storageDir: string, embeddingsDir: string) {
    this.manager = new LearningManager(storageDir, embeddingsDir);
    this.indexer = new DocsIndexer(storageDir, embeddingsDir);
  }

  async init(): Promise<void> {
    await this.manager.init();
    await this.indexer.init();
  }

  /**
   * Get all MCP tool definitions
   */
  getTools(): MCPTool[] {
    return [
      {
        name: "k-query",
        description:
          "Search learnings by text, area, or type. Supports both keyword (fast) and semantic (quality) search.",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Search text",
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
            semantic: {
              type: "boolean",
              description:
                "Use semantic search with embeddings (default: false, uses TF-IDF)",
            },
          },
        },
      },
      {
        name: "k-store",
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
        name: "k-related",
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
      {
        name: "k-index",
        description:
          "Index markdown documentation files as learnings with embeddings. Extracts sections from markdown and stores them with automatic area detection.",
        inputSchema: {
          type: "object",
          properties: {
            patterns: {
              type: "array",
              items: { type: "string" },
              description:
                "Glob patterns for markdown files (e.g., ['docs/**/*.md', 'README.md'])",
            },
            cwd: {
              type: "string",
              description:
                "Working directory for glob patterns (defaults to current directory)",
            },
            extractSections: {
              type: "boolean",
              description:
                "Extract sections by headings (default: true). If false, indexes entire file as one learning.",
            },
            minSectionLength: {
              type: "number",
              description:
                "Minimum section content length to index (default: 50)",
            },
            areaStrategy: {
              type: "string",
              enum: ["path", "filename", "content"],
              description:
                "Strategy for determining learning area: 'path' (from directory), 'filename', or 'content' (from first heading)",
            },
            defaultType: {
              type: "string",
              enum: ["entity", "relationship", "pattern", "decision"],
              description:
                "Default learning type when auto-detection doesn't match (default: 'entity')",
            },
          },
          required: ["patterns"],
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
      case "k-query":
        return this.handleQuery(args);
      case "k-store":
        return this.handleStore(args);
      case "k-related":
        return this.handleRelated(args);
      case "k-index":
        return this.handleIndex(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleQuery(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const params = args as QueryParams;
    const learnings = await this.manager.query(params);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(learnings, null, 2),
        },
      ],
    };
  }

  private async handleStore(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const params = args as StoreLearningParams;
    const learning = await this.manager.store(params);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(learning, null, 2),
        },
      ],
    };
  }

  private async handleRelated(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { id, limit = 5 } = args as { id: string; limit?: number };
    const related = await this.manager.getRelated(id, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(related, null, 2),
        },
      ],
    };
  }

  private async handleIndex(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const options = args as {
      patterns: string[];
      cwd?: string;
      extractSections?: boolean;
      minSectionLength?: number;
      areaStrategy?: "path" | "filename" | "content";
      defaultType?: LearningType;
    };

    // Validate patterns is present and non-empty
    if (!Array.isArray(options.patterns) || options.patterns.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: "patterns must be a non-empty array of glob patterns" },
              null,
              2,
            ),
          },
        ],
      };
    }

    const result = await this.indexer.index(options);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}
