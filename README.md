# graph-flow v2.0

File-based workflow checkpoint, knowledge management, and code graph analysis for Claude Code.

## Architecture

**No shared database = no lock contention = no freezing**

```
@graph-flow/checkpoint/     → .claude/workflows/*.jsonl (in-memory LRU cache)
@graph-flow/knowledge/      → .claude/learnings/*.jsonl (TF-IDF search)
@graph-flow/graph/          → .claude/graphs/*.json (hash-based parse cache)
@graph-flow/mcp/            → Unified MCP server (aggregates all tools)
```

## Features

### Checkpoint (Workflow Recovery)
- Track workflow state across sessions
- Store context, decisions, and blockers
- Resume interrupted work seamlessly
- **Tools:** `checkpoint-find`, `checkpoint-update`, `checkpoint-complete`

### Knowledge (Learning Persistence)
- Store learnings by code area
- TF-IDF search for relevant information
- Find related learnings
- **Tools:** `knowledge-query`, `knowledge-store`, `knowledge-related`

### Graph (Code Analysis)
- Parse TypeScript/JavaScript with ts-morph
- Find what calls a function (call graph)
- Calculate blast radius of changes
- Hash-based caching for performance
- **Tools:** `graph-calls`, `graph-blast`, `graph-defs`

## Installation

```bash
# Install dependencies
bun install

# Run migration (if coming from v1.x with SQLite)
bun run migrate

# Start MCP server (for testing)
bun run mcp
```


## CLI

Install the CLI (workspace or published package):

```bash
graph-flow tools
```

Examples:

```bash
graph-flow checkpoint-find --json '{"issue": 123}'
graph-flow knowledge-store --file ./learning.json
cat ./args.json | graph-flow graph-calls
```

## Storage Location

By default, data is stored in `~/.claude`.

Override with:

- `GRAPH_FLOW_DIR` (absolute path)
- `CLAUDE_PROJECT_DIR` (uses `$CLAUDE_PROJECT_DIR/.claude`)

## MCP Integration

Add to your `~/.claude/config.json`:

```json
{
  "mcpServers": {
    "graph-flow": {
      "command": "bun",
      "args": ["run", "packages/mcp/src/index.ts"],
      "cwd": "/Users/hailmary/Code/rollercoaster.dev/graph-flow"
    }
  }
}
```

Or use the included `.mcp.json` by running from this directory.

## Usage

### Checkpoint Tools

```typescript
// Find workflow by issue number
checkpoint-find { issue: 123 }

// Update workflow
checkpoint-update {
  id: "workflow-123",
  phase: "implement",
  context: ["Added authentication"],
  decisions: ["Using JWT tokens"]
}

// Complete workflow
checkpoint-complete { id: "workflow-123", delete: true }
```

### Knowledge Tools

```typescript
// Search learnings
knowledge-query { text: "authentication", area: "auth", limit: 10 }

// Store learning
knowledge-store {
  area: "auth",
  type: "pattern",
  content: "Use JWT tokens in httpOnly cookies"
}

// Find related learnings
knowledge-related { id: "learning-id", limit: 5 }
```

### Graph Tools

```typescript
// Find what calls a function
graph-calls { name: "getDatabase", files: ["src/**/*.ts"] }

// Calculate blast radius
graph-blast { name: "updateUser", files: ["src/**/*.ts"], maxDepth: 3 }

// Get all definitions in a file
graph-defs { file: "src/auth/login.ts" }
```

## Storage Format

### Workflows (`.claude/workflows/{id}.jsonl`)
```jsonl
{"timestamp":"2024-01-01T00:00:00Z","type":"created","data":{...}}
{"timestamp":"2024-01-01T00:01:00Z","type":"phase_change","data":{...}}
{"timestamp":"2024-01-01T00:02:00Z","type":"context_added","data":{...}}
```

### Learnings (`.claude/learnings/{area}.jsonl`)
```jsonl
{"id":"uuid","timestamp":"2024-01-01T00:00:00Z","area":"auth","type":"entity","content":"..."}
{"id":"uuid","timestamp":"2024-01-01T00:01:00Z","area":"auth","type":"pattern","content":"..."}
```

### Graphs (`.claude/graphs/{file}-{hash}.json`)
```json
{
  "fileHash": "abc123...",
  "timestamp": "2024-01-01T00:00:00Z",
  "entities": [...],
  "relationships": [...]
}
```

## Testing

```bash
# Run all tests
bun test

# Run specific package tests
bun test packages/checkpoint
bun test packages/knowledge
bun test packages/graph
```

## Migration from v1.x

If you have an existing SQLite database from v1.x:

1. Run migration script: `bun run migrate`
2. Verify counts match
3. Update MCP config to point to new server
4. Restart Claude Code
5. Test all tools work
6. Keep backup for 2 weeks, then delete if all works well

## Why v2.0?

**Problem:** SQLite lock contention caused Claude Code to freeze
**Solution:** File-based storage - no locks, no freezing

**Problem:** Monolithic 1131-line sqlite.ts was hard to refactor
**Solution:** 3 independent packages, each <500 LOC

**Problem:** Tools exist but blocked by DB issues
**Solution:** Build working tools first, optimize later

## Philosophy

- **Non-blocking:** Separate files = no lock contention
- **Graceful:** Missing file = fresh start, no crash
- **Simple:** Each package does one thing well
- **Valuable:** Tools work and provide value whenever used

Build the tools, make them work, let Claude use them.
