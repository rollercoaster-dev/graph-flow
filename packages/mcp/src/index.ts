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
import { AutomationMCPTools } from "@graph-flow/automation";
import { spawnSync } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";

const pkgModule = await import("../package.json");
const pkg = pkgModule.default ?? pkgModule;

/**
 * Parse `owner/repo` from a git remote URL.
 * Handles both HTTPS and SSH formats.
 */
function parseGitHubRepo(remoteUrl: string): string | null {
  const match = remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(\.git)?$/);
  return match ? match[1] : null;
}

/**
 * Try to resolve a GitHub repo from a directory's git remote.
 */
function repoFromDir(dir: string): string | null {
  try {
    const result = spawnSync(["git", "-C", dir, "remote", "get-url", "origin"]);
    if (result.success) {
      return parseGitHubRepo(result.stdout.toString().trim());
    }
  } catch {
    // git not available or not a repo
  }
  return null;
}

/**
 * Resolve the GitHub repo (owner/repo) for gh CLI calls.
 * Fallback chain: env var → GRAPH_FLOW_DIR → CLAUDE_PROJECT_DIR → cwd → null.
 */
export function resolveGitHubRepo(): string | null {
  // 1. Explicit env var (highest priority)
  const explicit = process.env.GRAPH_FLOW_GITHUB_REPO?.trim();
  if (explicit) return explicit;

  // 2. From GRAPH_FLOW_DIR git remote
  const gfDir = process.env.GRAPH_FLOW_DIR?.trim();
  if (gfDir) {
    // Strip /.claude suffix if present (GRAPH_FLOW_DIR points to .claude subdir)
    const dir = gfDir.endsWith("/.claude") ? gfDir.slice(0, -7) : gfDir;
    const repo = repoFromDir(dir);
    if (repo) return repo;
  }

  // 3. From CLAUDE_PROJECT_DIR git remote
  const projectDir = process.env.CLAUDE_PROJECT_DIR?.trim();
  if (projectDir) {
    const repo = repoFromDir(projectDir);
    if (repo) return repo;
  }

  // 4. From cwd git remote
  const repo = repoFromDir(process.cwd());
  if (repo) return repo;

  // 5. Graceful degradation
  return null;
}

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
  private automation!: AutomationMCPTools;
  private githubRepo?: string;

  constructor(options: { baseDir?: string; githubRepo?: string | null } = {}) {
    const baseDir = options.baseDir ?? resolveBaseDir();
    const githubRepo = options.githubRepo !== undefined
      ? (options.githubRepo ?? undefined)
      : (resolveGitHubRepo() ?? undefined);

    if (githubRepo) {
      console.error(`graph-flow: using GitHub repo ${githubRepo}`);
    } else {
      console.error("graph-flow: no GitHub repo detected, gh CLI calls may fail in plugin context");
    }

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
    this.planning = new PlanningMCPTools(planningDir, githubRepo);
    this.githubRepo = githubRepo;

    this.setupHandlers();
  }

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Lazy initialization - called on first tool use, not on server start
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      await this.checkpoint.init();
      await this.knowledge.init();
      await this.graph.init();
      await this.planning.init();
      this.automation = new AutomationMCPTools(
        this.planning.getManager(),
        this.checkpoint.getManager(),
        this.githubRepo
      );
      await this.automation.init();
      this.initialized = true;
    })();

    await this.initPromise;
  }

  async init(): Promise<void> {
    // No-op - initialization is now lazy
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Ensure lazy initialization completes before listing tools
      await this.ensureInitialized();

      const checkpointTools = this.checkpoint.getTools();
      const knowledgeTools = this.knowledge.getTools();
      const graphTools = this.graph.getTools();
      const planningTools = this.planning.getTools();
      const automationTools = this.automation.getTools();

      return {
        tools: [...checkpointTools, ...knowledgeTools, ...graphTools, ...planningTools, ...automationTools],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Lazy init on first tool call
        await this.ensureInitialized();

        // Route to appropriate subsystem
        if (name.startsWith("c-")) {
          return await this.checkpoint.handleToolCall(name, args || {});
        } else if (name.startsWith("k-")) {
          return await this.knowledge.handleToolCall(name, args || {});
        } else if (name.startsWith("g-")) {
          return await this.graph.handleToolCall(name, args || {});
        } else if (name.startsWith("p-")) {
          return await this.planning.handleToolCall(name, args || {});
        } else if (name.startsWith("a-")) {
          return await this.automation.handleToolCall(name, args || {});
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
    // Lazy init on resource read
    await this.ensureInitialized();

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
  // No init() call - initialization is now lazy on first tool use
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
