import { GraphQuery } from "./query.ts";
import { CodeIndexer } from "./indexer.ts";

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
 * MCP tools for code graph operations
 */
export class GraphMCPTools {
  private query: GraphQuery;
  private indexer: CodeIndexer;

  constructor(cacheDir: string) {
    this.query = new GraphQuery(cacheDir);
    this.indexer = new CodeIndexer(cacheDir);
  }

  async init(): Promise<void> {
    await this.query.init();
    await this.indexer.init();
  }

  /**
   * Get all MCP tool definitions
   */
  getTools(): MCPTool[] {
    return [
      {
        name: "graph-calls",
        description: "Find what calls a given function or method",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Entity name (function, class, method)",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Files to search (glob patterns supported)",
            },
          },
          required: ["name", "files"],
        },
      },
      {
        name: "graph-blast",
        description: "Calculate blast radius - what entities are impacted by changes",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Entity name (function, class, method)",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Files to search",
            },
            maxDepth: {
              type: "number",
              description: "Maximum depth to traverse (default: 3)",
            },
          },
          required: ["name", "files"],
        },
      },
      {
        name: "graph-defs",
        description: "Get all definitions in a file",
        inputSchema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "File path",
            },
          },
          required: ["file"],
        },
      },
      {
        name: "graph-index",
        description: "Batch index code files to populate graph cache",
        inputSchema: {
          type: "object",
          properties: {
            patterns: {
              type: "array",
              items: { type: "string" },
              description: "Glob patterns for files to index (e.g., ['src/**/*.ts'])",
            },
            cwd: {
              type: "string",
              description: "Working directory for glob expansion (optional)",
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
  async handleToolCall(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    switch (name) {
      case "graph-calls":
        return this.handleWhatCalls(args);
      case "graph-blast":
        return this.handleBlastRadius(args);
      case "graph-defs":
        return this.handleDefinitions(args);
      case "graph-index":
        return this.handleIndex(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleWhatCalls(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { name, files } = args as { name: string; files: string[] };
    const result = await this.query.whatCalls(name, files);

    if (!result) {
      return {
        content: [{
          type: "text",
          text: `Entity "${name}" not found`,
        }],
      };
    }

    const summary = {
      entity: result.entity,
      callerCount: result.callers.length,
      callers: result.callers.map(c => ({
        name: c.caller.name,
        type: c.caller.type,
        location: c.caller.location,
      })),
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(summary, null, 2),
      }],
    };
  }

  private async handleBlastRadius(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { name, files, maxDepth = 3 } = args as {
      name: string;
      files: string[];
      maxDepth?: number;
    };

    const result = await this.query.blastRadius(name, files, maxDepth);

    if (!result) {
      return {
        content: [{
          type: "text",
          text: `Entity "${name}" not found`,
        }],
      };
    }

    const summary = {
      entity: result.entity,
      impactCount: result.impactedEntities.length,
      impactedEntities: result.impactedEntities.map(i => ({
        name: i.entity.name,
        type: i.entity.type,
        distance: i.distance,
        path: i.path,
        location: i.entity.location,
      })),
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(summary, null, 2),
      }],
    };
  }

  private async handleDefinitions(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { file } = args as { file: string };
    const definitions = await this.query.getDefinitions(file);

    const summary = {
      file,
      count: definitions.length,
      definitions: definitions.map(d => ({
        name: d.name,
        type: d.type,
        line: d.location.line,
      })),
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(summary, null, 2),
      }],
    };
  }

  private async handleIndex(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { patterns, cwd } = args as { patterns: string[]; cwd?: string };

    const result = await this.indexer.index({ patterns, cwd });

    const summary = {
      totalFiles: result.totalFiles,
      cachedFiles: result.cachedFiles,
      parsedFiles: result.parsedFiles,
      failedFiles: result.failedFiles,
      totalEntities: result.totalEntities,
      totalRelationships: result.totalRelationships,
      totalTime: Math.round(result.totalTime),
      errors: result.errors.length > 0 ? result.errors : undefined,
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(summary, null, 2),
      }],
    };
  }
}
