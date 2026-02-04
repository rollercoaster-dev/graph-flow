# graph-flow v2.0 Quick Start

Get up and running in 5 minutes.

## Installation

```bash
cd <path-to-graph-flow>
bun install
bun test
```

## Configuration

Add a `.mcp.json` to your project root (or run `graph-flow init` to generate one):

```json
{
  "mcpServers": {
    "graph-flow": {
      "command": "bun",
      "args": ["run", "<path-to-graph-flow>/packages/mcp/src/index.ts"],
      "env": {
        "CLAUDE_PROJECT_DIR": "<your-project-root>"
      }
    }
  }
}
```

Setting `CLAUDE_PROJECT_DIR` ensures each project stores its data in its own `.claude/` directory, preventing cross-project data leaks.

Restart Claude Code.

## First Steps

### 1. Create a workflow checkpoint

```typescript
checkpoint-update {
  id: "my-first-workflow",
  phase: "research",
  context: ["Learning how graph-flow works"],
  decisions: ["Starting with checkpoint tools"]
}
```

### 2. Store a learning

```typescript
knowledge-store {
  area: "graph-flow",
  type: "pattern",
  content: "Workflows use event sourcing with JSONL files"
}
```

### 3. Search learnings

```typescript
knowledge-query {
  text: "workflow event",
  limit: 5
}
```

### 4. Analyze code

```typescript
graph-defs {
  file: "packages/checkpoint/src/workflow.ts"
}
```

### 5. Find function callers

```typescript
graph-calls {
  name: "WorkflowManager",
  files: ["packages/checkpoint/src/**/*.ts"]
}
```

## Tool Reference

### Checkpoint Tools

| Tool | Purpose | Example |
|------|---------|---------|
| `checkpoint-find` | Find workflow by issue or ID | `checkpoint-find { issue: 123 }` |
| `checkpoint-update` | Update workflow state | `checkpoint-update { id: "w-123", phase: "implement" }` |
| `checkpoint-complete` | Mark complete and delete | `checkpoint-complete { id: "w-123" }` |

### Knowledge Tools

| Tool | Purpose | Example |
|------|---------|---------|
| `knowledge-query` | Search learnings | `knowledge-query { text: "API", area: "backend" }` |
| `knowledge-store` | Store new learning | `knowledge-store { area: "api", type: "entity", content: "..." }` |
| `knowledge-related` | Find related learnings | `knowledge-related { id: "uuid" }` |

### Graph Tools

| Tool | Purpose | Example |
|------|---------|---------|
| `graph-calls` | What calls this? | `graph-calls { name: "login", files: ["src/**/*.ts"] }` |
| `graph-blast` | Blast radius | `graph-blast { name: "updateUser", files: ["src/**/*.ts"] }` |
| `graph-defs` | List definitions | `graph-defs { file: "src/auth.ts" }` |

## Storage Locations

When `CLAUDE_PROJECT_DIR` is set, data is stored per-project:

```text
<project-root>/.claude/
├── workflows/     # Your workflow checkpoints (auto-deleted on complete)
├── learnings/     # Your accumulated knowledge (persistent)
├── embeddings/    # Vector embeddings for semantic search
├── graphs/        # Cached code analysis (auto-invalidated on changes)
└── planning/      # Planning stack state
```

Falls back to `~/.claude/` if `CLAUDE_PROJECT_DIR` is not set (shared across all projects).

## Common Workflows

### Starting a new task

```typescript
// 1. Create checkpoint
checkpoint-update {
  id: "issue-456",
  phase: "research",
  context: ["Working on authentication bug"]
}

// 2. As you learn, store knowledge
knowledge-store {
  area: "auth",
  type: "pattern",
  content: "JWT tokens stored in httpOnly cookies"
}

// 3. Understand code impact
graph-blast {
  name: "validateToken",
  files: ["src/**/*.ts"]
}

// 4. Make decision
checkpoint-update {
  id: "issue-456",
  decisions: ["Will add refresh token rotation"]
}

// 5. Complete
checkpoint-complete { id: "issue-456" }
```

### Searching for context

```typescript
// Find learnings about a topic
knowledge-query {
  text: "authentication security",
  limit: 10
}

// Find what calls a function
graph-calls {
  name: "hashPassword",
  files: ["src/**/*.ts"]
}

// Check blast radius before refactoring
graph-blast {
  name: "UserModel",
  files: ["src/**/*.ts"],
  maxDepth: 2
}
```

## Troubleshooting

### Tools not appearing?

1. Check `.mcp.json` in your project root has correct path
2. Restart Claude Code completely
3. Check logs: `<project-root>/.claude/logs/` (or `~/.claude/logs/` if `CLAUDE_PROJECT_DIR` not set)

### Slow search?

```bash
# Check learning count (use your project root if CLAUDE_PROJECT_DIR is set)
ls -l <project-root>/.claude/learnings/*.jsonl | wc -l

# TF-IDF is fast for <50k learnings
# If you have more, consider archiving old learnings
```

### Cache issues?

```bash
# Clear graph cache (rebuilds on next parse)
rm -rf <project-root>/.claude/graphs/*.json
```

## Migration from v1.x

If you have existing SQLite data:

```bash
bun run migrate
# Follow prompts, backup is created automatically
```

## Next Steps

- Read [README.md](README.md) for full feature overview
- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand how it works
- Read [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment

## Help

- All tests passing? `bun test`
- Server running? Check MCP config
- Tools working? Try the examples above

**You're ready to go! Start using the tools and provide feedback.**
