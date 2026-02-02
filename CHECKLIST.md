# graph-flow v2.0 Deployment Checklist

## Pre-Deployment Verification

- [x] All packages created and structured
  - [x] @graph-flow/checkpoint
  - [x] @graph-flow/knowledge
  - [x] @graph-flow/graph
  - [x] @graph-flow/mcp

- [x] All tests passing (31/31)
  - [x] checkpoint: 17 tests
  - [x] knowledge: 5 tests
  - [x] graph: 5 tests
  - [x] mcp: 4 integration tests

- [x] MCP server implemented
  - [x] 9 tools registered (3 per subsystem)
  - [x] Resources defined
  - [x] Request routing works
  - [x] Error handling in place

- [x] Migration script created
  - [x] SQLite export to JSONL
  - [x] Backup creation
  - [x] Validation logic
  - [x] User-friendly output

- [x] Documentation complete
  - [x] README.md (user-facing)
  - [x] ARCHITECTURE.md (technical deep dive)
  - [x] DEPLOYMENT.md (deployment guide)
  - [x] IMPLEMENTATION_SUMMARY.md (overview)

## Deployment Steps

### Step 1: Verify Local Setup
```bash
cd /Users/hailmary/Code/rollercoaster.dev/graph-flow

# Verify dependencies installed
bun install

# Run all tests
bun test

# Expected: 31 pass, 0 fail
```

### Step 2: Backup Existing Data (if migrating from v1.x)
```bash
# Backup will be created automatically by migration script
# Location: ~/.claude/execution-state-backup-{timestamp}.db
```

### Step 3: Run Migration (if applicable)
```bash
bun run migrate

# Review output for:
# - Backup created
# - Workflow count matches
# - Learning count matches
# - No errors
```

### Step 4: Update MCP Configuration

**Option A: Use project .mcp.json**
```bash
# The project includes .mcp.json already configured
# Just run Claude Code from this directory
```

**Option B: Update ~/.claude/config.json**
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

### Step 5: Restart Claude Code
```bash
# Completely restart Claude Code
# - Quit application
# - Restart
# - Verify MCP server connected
```

### Step 6: Verify Tools Available

In Claude Code, test each tool:

**Checkpoint:**
```typescript
checkpoint-find {}  // Should return empty array or existing workflows
```

**Knowledge:**
```typescript
knowledge-store { area: "test", type: "entity", content: "Test learning" }
knowledge-query { area: "test" }  // Should return the test learning
```

**Graph:**
```typescript
graph-defs { file: "packages/checkpoint/src/workflow.ts" }
// Should return all entities in the file
```

### Step 7: Monitor Performance

Watch for:
- Tool response times (<100ms expected)
- No freezing during concurrent usage
- No errors in logs

### Step 8: Clean Up (after 2 weeks of stable operation)
```bash
# Remove old database backup
rm ~/.claude/execution-state-backup-*.db

# Remove old monorepo package (if applicable)
# Only after verifying v2.0 works perfectly
```

## Post-Deployment Verification

- [ ] All 9 MCP tools are visible in Claude Code
- [ ] Tools respond within 100ms
- [ ] No freezing during concurrent tool usage
- [ ] Workflows persist across sessions
- [ ] Learnings are searchable
- [ ] Graph parsing works on real code
- [ ] Migration completed successfully (if applicable)
- [ ] Backup created and verified (if applicable)

## Rollback Plan (if needed)

If v2.0 has issues:

1. **Restore old MCP config:**
   ```bash
   # Point back to v1.x server
   # Or remove graph-flow from config entirely
   ```

2. **Restore database backup:**
   ```bash
   cp ~/.claude/execution-state-backup-*.db {original-location}
   ```

3. **Report issues:**
   - Document what went wrong
   - Include error messages
   - Note reproduction steps

## Success Indicators

✅ Tools work without freezing
✅ Response times <100ms
✅ Data persists correctly
✅ Search returns relevant results
✅ Graph analysis is accurate
✅ No errors in Claude Code logs

## Known Limitations

- TF-IDF search optimized for <50k learnings
- Graph parser handles files <10k LOC efficiently
- LRU cache limited to 100 concurrent workflows
- Migration requires manual trigger (not automatic)

## Support

Questions or issues? Check:
1. README.md - Basic usage and features
2. ARCHITECTURE.md - How it works internally
3. DEPLOYMENT.md - Detailed deployment guide
4. GitHub issues - Report problems

## Sign-Off

Deployment verified by: _________________

Date: _________________

Notes: _________________________________________________

________________________________________________________

________________________________________________________
