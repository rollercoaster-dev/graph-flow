---
name: init
description: Set up graph-flow MCP tools for the current project by creating/updating .mcp.json
allowed-tools: Bash, Read, Write
---

# Init Command

Sets up the graph-flow MCP server in the current project's `.mcp.json`.

## Workflow

### Step 1: Check existing config

Check if `.mcp.json` exists in the project root:

```bash
cat .mcp.json 2>/dev/null || echo '{"mcpServers":{}}'
```

### Step 2: Create/update .mcp.json

Parse the existing config (or start fresh). Add/update the `graph-flow` server entry while preserving all other `mcpServers` entries:

```json
{
  "mcpServers": {
    "graph-flow": {
      "command": "bun",
      "args": ["run", "${CLAUDE_PLUGIN_ROOT}/packages/mcp/src/index.ts"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${PROJECT_DIR}"
      }
    }
  }
}
```

Where:
- `${CLAUDE_PLUGIN_ROOT}` is replaced with the actual absolute path to the graph-flow plugin directory
- `${PROJECT_DIR}` is replaced with the current working directory (the project root)

### Step 3: Write the file

Write the merged config back to `.mcp.json`.

### Step 4: Report

```text
INIT COMPLETE

graph-flow MCP server added to .mcp.json

Server: bun run <plugin-path>/packages/mcp/src/index.ts
Data:   <project-dir>/.claude/

**Restart Claude Code to load MCP tools.**

After restart, tools will be available:
- c- (checkpoint): c-find, c-update, c-complete, c-recover
- k- (knowledge): k-query, k-store, k-related, k-index
- g- (graph): g-blast, g-index
- p- (planning): p-goal, p-interrupt, p-done, p-stack, p-plan, p-steps, p-progress, p-sync
- a- (automation): a-import, a-create-issue, a-board-update
```
