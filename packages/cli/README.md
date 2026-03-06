# @graph-flow/cli

Command-line access to graph-flow tools and the fallback surface for hosts that do not expose MCP yet.

## Usage

```bash
# Initialize a project and write .mcp.json
graph-flow init

# Validate host/MCP setup
graph-flow doctor

# List all available tools
graph-flow tools

# Call a tool with JSON args
graph-flow c-find --json '{"issue": 123}'

# Read args from a JSON file
graph-flow k-store --file ./learning.json

# Read args from stdin
cat ./args.json | graph-flow g-calls

# Pretty-print JSON output
graph-flow p-stack --pretty
```

## Planning Tools

```bash
# Push a goal onto the stack
graph-flow p-goal --json '{"title": "Implement feature X"}'

# Push an interrupt (context switch)
graph-flow p-interrupt --json '{"title": "Fix prod bug", "reason": "Critical issue"}'

# Pop top item (mark as completed)
graph-flow p-done --json '{"summary": "Fixed the bug"}'

# View current stack with stale detection
graph-flow p-stack --pretty

# Create a plan for a goal
graph-flow p-plan --json '{"title": "Feature X Plan", "goalId": "goal-xxx", "sourceType": "manual"}'

# Add steps to a plan
graph-flow p-steps --json '{"planId": "plan-xxx", "steps": [{"title": "Step 1", "ordinal": 1, "wave": 1, "externalRef": {"type": "issue", "number": 123}}]}'

# Get plan and steps
graph-flow p-progress --json '{"goalId": "goal-xxx"}' --pretty

# Get progress for a plan
graph-flow p-progress --json '{"planId": "plan-xxx"}' --pretty
```

## Storage Location

By default, data is stored in `~/.claude`.

Override with:

- `GRAPH_FLOW_DIR` (absolute path)
- `CLAUDE_PROJECT_DIR` (uses `$CLAUDE_PROJECT_DIR/.claude`)
