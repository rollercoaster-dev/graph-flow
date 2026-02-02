#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CheckpointMCPTools } from "@graph-flow/checkpoint";
import { KnowledgeMCPTools } from "@graph-flow/knowledge";
import { GraphMCPTools } from "@graph-flow/graph";
import { homedir } from "node:os";
import { join } from "node:path";

// Storage directories
const CLAUDE_DIR = join(homedir(), ".claude");
const WORKFLOWS_DIR = join(CLAUDE_DIR, "workflows");
const LEARNINGS_DIR = join(CLAUDE_DIR, "learnings");
const GRAPHS_DIR = join(CLAUDE_DIR, "graphs");

/**
 * Unified MCP server for graph-flow
 */
class GraphFlowServer {
  private server: Server;
  private checkpoint: CheckpointMCPTools;
  private knowledge: KnowledgeMCPTools;
  private graph: GraphMCPTools;

  constructor() {
    this.server = new Server(
      {
        name: "graph-flow",
        version: "2.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.checkpoint = new CheckpointMCPTools(WORKFLOWS_DIR);
    this.knowledge = new KnowledgeMCPTools(LEARNINGS_DIR);
    this.graph = new GraphMCPTools(GRAPHS_DIR);

    this.setupHandlers();
  }

  async init(): Promise<void> {
    await this.checkpoint.init();
    await this.knowledge.init();
    await this.graph.init();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const checkpointTools = this.checkpoint.getTools();
      const knowledgeTools = this.knowledge.getTools();
      const graphTools = this.graph.getTools();

      return {
        tools: [...checkpointTools, ...knowledgeTools, ...graphTools],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Route to appropriate subsystem
        if (name.startsWith("checkpoint-")) {
          return await this.checkpoint.handleToolCall(name, args || {});
        } else if (name.startsWith("knowledge-")) {
          return await this.knowledge.handleToolCall(name, args || {});
        } else if (name.startsWith("graph-")) {
          return await this.graph.handleToolCall(name, args || {});
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: "checkpoint://workflows",
            name: "Active Workflows",
            mimeType: "application/json",
            description: "Browse active workflow checkpoints",
          },
          {
            uri: "knowledge://learnings",
            name: "Learnings",
            mimeType: "application/json",
            description: "Browse stored learnings by area",
          },
          {
            uri: "graph://entities",
            name: "Code Graph Entities",
            mimeType: "application/json",
            description: "Browse code graph entities and relationships",
          },
        ],
      };
    });

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri.startsWith("checkpoint://")) {
        // Return list of active workflows
        const result = await this.checkpoint.handleToolCall("checkpoint-find", {});
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: result.content[0].text,
            },
          ],
        };
      } else if (uri.startsWith("knowledge://")) {
        // Return learnings (optionally filtered by area)
        const area = uri.replace("knowledge://learnings/", "");
        const args = area && area !== "learnings" ? { area } : {};
        const result = await this.knowledge.handleToolCall("knowledge-query", args);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: result.content[0].text,
            },
          ],
        };
      } else {
        throw new Error(`Unknown resource: ${uri}`);
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("graph-flow MCP server running on stdio");
  }
}

// Start server
const server = new GraphFlowServer();
await server.init();
await server.run();
