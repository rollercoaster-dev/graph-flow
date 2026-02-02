# @graph-flow/mcp

Unified MCP server exposing checkpoint, knowledge, and graph tools for Claude Code.

## Install

```bash
bun add @graph-flow/mcp
```

## MCP Configuration

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "graph-flow": {
      "command": "bun",
      "args": ["run", "/path/to/graph-flow/packages/mcp/src/index.ts"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `checkpoint-find` | Find workflow checkpoint by issue number or ID |
| `checkpoint-update` | Update workflow with context, decisions, or blockers |
| `checkpoint-complete` | Mark workflow as completed |
| `knowledge-store` | Store a new learning |
| `knowledge-query` | Search learnings by text, area, or type |
| `knowledge-related` | Find related learnings by ID |
| `graph-calls` | Find what calls a given function |
| `graph-blast` | Calculate blast radius of changes |
| `graph-defs` | Get all definitions in a file |

## License

MIT
