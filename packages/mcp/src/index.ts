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
import { KnowledgeMCPTools, getCurrentProviderType } from "@graph-flow/knowledge";
import { GraphMCPTools } from "@graph-flow/graph";
import { PlanningMCPTools } from "@graph-flow/planning";
import { homedir } from "node:os";
import { join } from "node:path";

const pkgModule = await import("../package.json");
const pkg = pkgModule.default ?? pkgModule;

/** Resolve the base directory for graph-flow data storage. */
function resolveBaseDir(): string {
  const explicit = process.env.GRAPH_FLOW_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR?.trim();
  if (projectDir) {
    return join(projectDir, ".claude");
  }
  console.error(
    "warning: CLAUDE_PROJECT_DIR not set, using ~/.claude (data will be shared across all projects). " +
      "Set CLAUDE_PROJECT_DIR in your .mcp.json env or run 'graph-flow init' in your project."
  );
  return join(homedir(), ".claude");
}

/**
 * Unified MCP server for graph-flow
 */
export class GraphFlowServer {
  private server: Server;
  private checkpoint: CheckpointMCPTools;
  private knowledge: KnowledgeMCPTools;
  private graph: GraphMCPTools;
  private planning: PlanningMCPTools;

  constructor(options: { baseDir?: string } = {}) {
    const baseDir = options.baseDir ?? resolveBaseDir();
    const workflowsDir = join(baseDir, "workflows");
    const learningsDir = join(baseDir, "learnings");
    const embeddingsDir = join(baseDir, "embeddings");
    const graphsDir = join(baseDir, "graphs");
    const planningDir = join(baseDir, "planning");

    this.server = new Server(
      {
        name: "graph-flow",
        version: pkg.version,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.checkpoint = new CheckpointMCPTools(workflowsDir);
    this.knowledge = new KnowledgeMCPTools(learningsDir, embeddingsDir);
    this.graph = new GraphMCPTools(graphsDir);
    this.planning = new PlanningMCPTools(planningDir);

    this.setupHandlers();
  }

  async init(): Promise<void> {
    await this.checkpoint.init();
    await this.knowledge.init();
    await this.graph.init();
    await this.planning.init();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const checkpointTools = this.checkpoint.getTools();
      const knowledgeTools = this.knowledge.getTools();
      const graphTools = this.graph.getTools();
      const planningTools = this.planning.getTools();

      return {
        tools: [...checkpointTools, ...knowledgeTools, ...graphTools, ...planningTools],
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
        } else if (name.startsWith("planning-")) {
          return await this.planning.handleToolCall(name, args || {});
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
          isError: true,
        };
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return this.listResourcesImpl();
    });

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return this.readResourceImpl(uri);
    });
  }

  private listResourcesImpl(): { resources: Array<{ uri: string; name: string; mimeType: string; description: string }> } {
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
      ],
    };
  }

  private async readResourceImpl(
    uri: string
  ): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
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
      const base = "knowledge://learnings";
      let args: Record<string, unknown> = {};
      if (uri === base || uri === `${base}/`) {
        args = {};
      } else if (uri.startsWith(`${base}/`)) {
        const area = uri.slice(base.length + 1);
        args = area ? { area } : {};
      } else {
        throw new Error(`Unknown knowledge resource: ${uri}`);
      }
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
  }

  listResourcesForTests(): { resources: Array<{ uri: string; name: string; mimeType: string; description: string }> } {
    return this.listResourcesImpl();
  }

  async readResourceForTests(
    uri: string
  ): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    return this.readResourceImpl(uri);
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    const provider = getCurrentProviderType() ?? "tfidf";
    console.error(`graph-flow MCP server running on stdio (embeddings: ${provider})`);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}

// Start server when executed directly
if (import.meta.main) {
  const server = new GraphFlowServer({ baseDir: resolveBaseDir() });
  await server.init();
  await server.run();

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch {
      // Best-effort cleanup
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
