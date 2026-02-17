import { DocsStore } from "./store.ts";
import { DocsSearch } from "./search.ts";
import type { DocsIndexOptions } from "./types.ts";

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
 * MCP tools for docs graph operations.
 *
 * d-index: Index markdown files, building hierarchical sections and
 *          DOCUMENTS relationships (backtick code refs → code entity names).
 * d-query: Semantic search over indexed doc sections.
 * d-for-code: Find doc sections that document a given code entity.
 */
export class DocsMCPTools {
  private store: DocsStore;
  private search: DocsSearch;

  constructor(storeDir: string, embeddingsDir: string) {
    this.store = new DocsStore(storeDir);
    this.search = new DocsSearch(embeddingsDir);
  }

  async init(): Promise<void> {
    await this.store.init();
    await this.search.init();
  }

  getTools(): MCPTool[] {
    return [
      {
        name: "d-index",
        description:
          "Index markdown documentation files into the docs graph. Parses hierarchical sections, extracts code references (backtick identifiers), and builds DOCUMENTS relationships between docs and code entities. Run before d-query or d-for-code.",
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
              description: "Working directory for glob expansion (optional)",
            },
            force: {
              type: "boolean",
              description: "Re-index even if file hash unchanged (default: false)",
            },
          },
          required: ["patterns"],
        },
      },
      {
        name: "d-query",
        description:
          "Semantic search over indexed doc sections. Returns ranked sections with heading, file path, anchor, and content snippet.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language search query",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 10)",
            },
            threshold: {
              type: "number",
              description: "Minimum similarity score 0.0–1.0 (default: 0.3)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "d-for-code",
        description:
          "Find doc sections that document a given code entity. Uses DOCUMENTS relationships built during d-index.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Code entity name (function, class, method)",
            },
          },
          required: ["name"],
        },
      },
    ];
  }

  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    switch (name) {
      case "d-index":
        return this.handleIndex(args);
      case "d-query":
        return this.handleQuery(args);
      case "d-for-code":
        return this.handleForCode(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleIndex(args: Record<string, unknown>): Promise<MCPToolResult> {
    const options = args as unknown as DocsIndexOptions;
    const result = await this.store.index(options);

    // After indexing, generate embeddings for new sections
    const graph = await this.store.load();
    const existingEmbeddings = new Set<string>(); // Fresh index — embed all
    await this.search.embedSections(Object.values(graph.sections), existingEmbeddings);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              filesIndexed: result.filesIndexed,
              filesSkipped: result.filesSkipped,
              totalSections: result.totalSections,
              linkedToCode: result.linkedToCode,
              errors: result.errors.length > 0 ? result.errors : undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleQuery(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { query, limit, threshold } = args as {
      query: string;
      limit?: number;
      threshold?: number;
    };

    const graph = await this.store.load();
    const results = await this.search.search(graph, query, { limit, threshold });

    const summary = results.map((r) => ({
      heading: r.section.heading,
      filePath: r.section.filePath,
      anchor: r.section.anchor,
      similarity: Math.round(r.similarity * 100) / 100,
      content: r.section.content.slice(0, 300) + (r.section.content.length > 300 ? "…" : ""),
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ query, resultCount: summary.length, results: summary }, null, 2),
        },
      ],
    };
  }

  private async handleForCode(args: Record<string, unknown>): Promise<MCPToolResult> {
    const { name } = args as { name: string };

    const graph = await this.store.load();
    const sections = this.search.getDocsForCode(graph, name);

    const summary = sections.map((s) => ({
      heading: s.heading,
      filePath: s.filePath,
      anchor: s.anchor,
      content: s.content.slice(0, 300) + (s.content.length > 300 ? "…" : ""),
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { name, docCount: summary.length, docs: summary },
            null,
            2,
          ),
        },
      ],
    };
  }
}
