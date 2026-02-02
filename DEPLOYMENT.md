# graph-flow v2.0 Deployment Guide

## Prerequisites

- Bun 1.0+ installed
- Claude Code installed
- (Optional) Existing v1.x SQLite database to migrate

## Fresh Installation

If you're starting fresh (no existing v1.x database):

```bash
# 1. Clone/navigate to project
cd /Users/hailmary/Code/rollercoaster.dev/graph-flow

# 2. Install dependencies
bun install

# 3. Run tests to verify everything works
bun test

# 4. Update Claude Code config
# Edit ~/.claude/config.json or use the included .mcp.json
```

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

```bash
# 5. Restart Claude Code
# The tools should now be available!
```

## Migration from v1.x

If you have an existing SQLite database from v1.x:

```bash
# 1. Install dependencies
bun install

# 2. Run migration script
bun run migrate

# This will:
# - Create backup of old database
# - Export workflows to .claude/workflows/*.jsonl
# - Export learnings to .claude/learnings/*.jsonl
# - Validate the migration

# 3. Update MCP config (same as above)

# 4. Restart Claude Code

# 5. Test tools work correctly
# Try: checkpoint-find, knowledge-query, graph-calls

# 6. Keep backup for 2 weeks
# If all works well, you can delete:
# ~/.claude/execution-state-backup-*.db
```

## Verification

After deployment, verify tools are working:

### Test Checkpoint Tools

```typescript
// In Claude Code, use the checkpoint-find tool
checkpoint-find {}  // Should return empty array (no workflows yet)
```

### Test Knowledge Tools

```typescript
// Store a test learning
knowledge-store {
  area: "test",
  type: "entity",
  content: "This is a test learning"
}

// Query it back
knowledge-query { area: "test" }  // Should return the learning
```

### Test Graph Tools

```typescript
// Get definitions in a TypeScript file
graph-defs { file: "packages/checkpoint/src/workflow.ts" }
// Should return all functions, classes, etc.
```

## Troubleshooting

### Tools not showing up in Claude Code

1. Check MCP server config path is correct
2. Restart Claude Code completely
3. Check logs: `~/.claude/logs/`

### Migration fails

1. Check backup was created: `~/.claude/execution-state-backup-*.db`
2. Verify old database path in migration script
3. Check permissions on `.claude/` directory

### Tests fail

```bash
# Run tests with verbose output
bun test --verbose

# Check specific package
bun test packages/checkpoint
bun test packages/knowledge
bun test packages/graph
```

### Performance issues

The file-based storage should be faster than SQLite, but if you notice issues:

1. Check `.claude/` directory size
2. Old workflows can be deleted (they're ephemeral)
3. Graph cache auto-invalidates on file changes
4. Knowledge search is optimized for <50k learnings

## Directory Structure

After deployment, you'll have:

```
~/.claude/
├── workflows/           # Active workflow checkpoints (ephemeral)
│   ├── workflow-123.jsonl
│   └── workflow-456.jsonl
├── learnings/           # Persistent learnings by area
│   ├── auth.jsonl
│   ├── api.jsonl
│   └── database.jsonl
└── graphs/              # Cached code graphs (auto-invalidate)
    ├── src_auth_login-abc123.json
    └── src_api_router-def456.json
```

## Maintenance

### Cleanup old workflows

Completed workflows are auto-deleted. Manual cleanup:

```bash
rm ~/.claude/workflows/*.jsonl
```

### Backup learnings

```bash
# Learnings are just JSONL files - copy them anywhere
cp -r ~/.claude/learnings ~/backups/learnings-$(date +%Y%m%d)
```

### Clear graph cache

```bash
rm -rf ~/.claude/graphs/*.json
# Cache will rebuild on next parse
```

## Success Criteria

✅ All 31 tests pass
✅ MCP server starts without errors
✅ Tools respond in <100ms
✅ No freezing during concurrent usage
✅ Can store and retrieve workflows
✅ Can store and search learnings
✅ Can parse and query code graphs

## Next Steps

Once deployed and verified:

1. Use checkpoint tools during development workflows
2. Store learnings as you discover patterns
3. Use graph tools to understand code relationships
4. Provide feedback on what works and what doesn't

The tools are designed to be non-intrusive - they work when you need them, stay out of your way when you don't.
