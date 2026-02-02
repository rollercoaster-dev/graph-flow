# graph-flow v2.0 Quick Start

Get up and running in 5 minutes.

## Installation

```bash
cd /Users/hailmary/Code/rollercoaster.dev/graph-flow
bun install
bun test  # Verify: 31 pass, 0 fail
```

## Configuration

Add to `~/.claude/config.json`:

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

```
~/.claude/
├── workflows/     # Your workflow checkpoints (auto-deleted on complete)
├── learnings/     # Your accumulated knowledge (persistent)
└── graphs/        # Cached code analysis (auto-invalidated on changes)
```

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

1. Check `~/.claude/config.json` has correct path
2. Restart Claude Code completely
3. Check logs: `~/.claude/logs/`

### Slow search?

```bash
# Check learning count
ls -l ~/.claude/learnings/*.jsonl | wc -l

# TF-IDF is fast for <50k learnings
# If you have more, consider archiving old learnings
```

### Cache issues?

```bash
# Clear graph cache (rebuilds on next parse)
rm -rf ~/.claude/graphs/*.json
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
