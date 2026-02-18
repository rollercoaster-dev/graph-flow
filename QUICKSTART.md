# graph-flow v3.0 Quick Start

Get up and running in 5 minutes.

## Installation

```bash
cd <path-to-graph-flow>
bun install
bun test
```

## Configuration

Add a `.mcp.json` to your project root (or run `/graph-flow:init` after installing the plugin):

```json
{
  "mcpServers": {
    "graph-flow": {
      "command": "bun",
      "args": ["run", "<path-to-graph-flow>/packages/mcp/src/index.ts"],
      "env": {
        "CLAUDE_PROJECT_DIR": "<project-root>"
      }
    }
  }
}
```

Setting `CLAUDE_PROJECT_DIR` ensures each project stores its data in its own `.claude/` directory, preventing cross-project data leaks.

Restart Claude Code.

### Optional: Configure Board Automation

`a-board-update` now reads board IDs from `.graph-flow.json` (or `BOARD_*` env vars).

```bash
cp .graph-flow.json.example .graph-flow.json
```

Then fill `board.projectId`, `board.fieldId`, `board.orgLogin`,
`board.projectNumber`, and all `board.statusOptions.*` fields.

## First Steps

### 1. Create a workflow checkpoint

```
c-update {
  id: "my-first-workflow",
  phase: "research",
  context: ["Learning how graph-flow works"],
  decisions: ["Starting with checkpoint tools"]
}
```

### 2. Store a learning

```
k-store {
  area: "graph-flow",
  type: "pattern",
  content: "Workflows use event sourcing with JSONL files"
}
```

### 3. Search learnings

```
k-query {
  text: "workflow event",
  limit: 5
}
```

### 4. Analyze blast radius

```
g-blast {
  name: "WorkflowManager",
  files: ["packages/checkpoint/src/**/*.ts"]
}
```

### 5. Index code for analysis

```
g-index {
  files: ["packages/checkpoint/src/**/*.ts"]
}
```

## Tool Reference

### Checkpoint Tools (4)

| Tool | Purpose | Example |
|------|---------|---------|
| `c-find` | Find workflow by issue or ID | `c-find { issue: 123 }` |
| `c-update` | Update workflow state | `c-update { id: "w-123", phase: "implement" }` |
| `c-complete` | Mark complete and delete | `c-complete { id: "w-123" }` |
| `c-recover` | Recover lost workflow | `c-recover { id: "w-123" }` |

### Knowledge Tools (4)

| Tool | Purpose | Example |
|------|---------|---------|
| `k-query` | Search learnings | `k-query { text: "API", area: "backend" }` |
| `k-store` | Store new learning | `k-store { area: "api", type: "entity", content: "..." }` |
| `k-related` | Find related learnings | `k-related { id: "uuid" }` |
| `k-index` | Rebuild search index | `k-index {}` |

### Graph Tools (4)

| Tool | Purpose | Example |
|------|---------|---------|
| `g-calls` | Find all callers of a function | `g-calls { name: "myFunction" }` |
| `g-defs` | List exports/definitions in a file | `g-defs { file: "src/foo.ts" }` |
| `g-blast` | Transitive impact analysis | `g-blast { name: "updateUser", files: ["src/**/*.ts"] }` |
| `g-index` | Populate code analysis cache | `g-index { files: ["src/**/*.ts"] }` |

### Docs Tools (3)

| Tool | Purpose | Example |
|------|---------|---------|
| `d-index` | Index markdown docs into graph | `d-index {}` |
| `d-query` | Semantic search over doc sections | `d-query { query: "how does auth work" }` |
| `d-for-code` | Find docs that reference a code entity | `d-for-code { name: "handleLogin" }` |

### Planning Tools (8)

| Tool | Purpose | Example |
|------|---------|---------|
| `p-goal` | Push goal onto stack | `p-goal { title: "Feature X" }` |
| `p-interrupt` | Push interrupt | `p-interrupt { title: "Bug fix", reason: "Prod issue" }` |
| `p-done` | Pop and complete top item | `p-done { summary: "Finished" }` |
| `p-stack` | View current stack | `p-stack {}` |
| `p-plan` | Create execution plan | `p-plan { title: "Plan", goalId: "goal-..." }` |
| `p-steps` | Add steps to plan | `p-steps { planId: "plan-...", steps: [...] }` |
| `p-progress` | Get plan + steps + progress | `p-progress { goalId: "goal-..." }` |
| `p-sync` | Sync step statuses from GitHub | `p-sync { planId: "plan-..." }` |

### Automation Tools (3)

| Tool | Purpose | Example |
|------|---------|---------|
| `a-import` | Import milestone or epic | `a-import { type: "milestone", number: 1 }` |
| `a-create-issue` | Create GitHub issue + link to plan | `a-create-issue { title: "New feature", planId: "plan-..." }` |
| `a-board-update` | Update GitHub project board status | `a-board-update { issueNumber: 123, status: "In Progress" }` |

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

```
// 1. Push goal
p-goal { title: "Fix authentication bug" }

// 2. Create checkpoint
c-update {
  id: "issue-456",
  phase: "research",
  context: ["Working on authentication bug"]
}

// 3. As you learn, store knowledge
k-store {
  area: "auth",
  type: "pattern",
  content: "JWT tokens stored in httpOnly cookies"
}

// 4. Understand code impact
g-blast {
  name: "validateToken",
  files: ["src/**/*.ts"]
}

// 5. Complete
p-done { summary: "Fixed auth bug" }
c-complete { id: "issue-456" }
```

### Import from GitHub

```
// Import a milestone into planning
a-import { type: "milestone", number: 1 }

// Import an epic
a-import { type: "epic", number: 42 }

// Update board status
a-board-update { issueNumber: 123, status: "In Progress" }
```

## Troubleshooting

### Tools not appearing?

1. Check `.mcp.json` in your project root has correct path
2. Restart Claude Code completely
3. Run `/graph-flow:init` to auto-configure
4. Run `graph-flow doctor` for a full environment check

### Slow search?

```bash
# Check learning count
ls -l <project-root>/.claude/learnings/*.jsonl | wc -l

# TF-IDF is fast for <50k learnings
# If you have more, consider archiving old learnings
```

### Cache issues?

```bash
# Clear graph cache (rebuilds on next parse)
rm -rf <project-root>/.claude/graphs/*.json
```

## Migration from v2.x

v3.0 renames tools to use short prefixes. Old tool names (`checkpoint-find`, `knowledge-query`, `graph-calls`, etc.) are no longer available. Update any scripts or CLAUDE.md references to use the new names (`c-find`, `k-query`, `g-blast`, etc.).

Removed tools:
- `p-planget` — merged into `p-progress`
- `p-step-update` — folded into `p-sync` as `manualOverrides` parameter
- `a-from-milestone` and `a-from-epic` — merged into `a-import`
- `a-start-issue` — use `p-goal` + `c-update` directly

## Next Steps

- Read [README.md](README.md) for full feature overview
- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand how it works
- See [PLUGIN_INSTALLATION.md](PLUGIN_INSTALLATION.md) for plugin setup

## Help

- All tests passing? `bun test`
- Server running? Check MCP config
- Tools working? Try the examples above

**You're ready to go! Start using the tools and provide feedback.**
