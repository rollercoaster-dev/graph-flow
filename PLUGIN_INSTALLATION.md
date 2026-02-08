# Installing graph-flow as a Local Plugin

graph-flow can be installed as a Claude Code plugin to make its skills and commands available across all your projects.

## Installation

### 1. Create a Local Marketplace

```bash
# Create marketplace structure
mkdir -p /Users/hailmary/Code/local-plugins/plugins
cd /Users/hailmary/Code/local-plugins/plugins
ln -s ../../rollercoaster.dev/graph-flow graph-flow
```

### 2. Create Marketplace Manifest

Create `/Users/hailmary/Code/local-plugins/.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "local",
  "description": "Local development plugins",
  "owner": {
    "name": "rollercoaster.dev",
    "email": "dev@rollercoaster.dev"
  },
  "plugins": [
    {
      "name": "graph-flow",
      "description": "Planning stack, workflow checkpoints, knowledge graph, and GitHub automation for Claude Code",
      "author": {
        "name": "rollercoaster.dev"
      },
      "source": "./plugins/graph-flow",
      "category": "development",
      "homepage": "https://github.com/rollercoaster-dev/graph-flow"
    }
  ]
}
```

### 3. Add Marketplace and Install Plugin

```bash
# Add the local marketplace
claude plugin marketplace add /Users/hailmary/Code/local-plugins

# Install graph-flow from the local marketplace
claude plugin install graph-flow@local --scope user

# Verify installation
claude plugin list | grep graph-flow
```

## Available Skills

After installation, these skills are available in all projects:

- `/setup` - Prepares environment for issue work
- `/implement` - Implementation phase
- `/review` - Review phase
- `/finalize` - Finalization phase
- `/issue-fetcher` - Fetch GitHub issue details
- `/board-manager` - Manage project board
- `/board-status` - Check board status
- `/milestone-tracker` - Track milestone progress
- `/pr-review-checker` - Check PR review status
- `/markdown-reviewer` - Review markdown files

## Available Commands

- `/auto-epic` - Create epic from milestone
- `/auto-issue` - Create and work on issue
- `/auto-milestone` - Create milestone workflow
- `/auto-merge` - Auto-merge workflow
- `/visual-auto-issue` - Visual issue workflow
- `/visual-work-on-issue` - Visual work on issue
- `/worktree` - Git worktree management

## Updating the Plugin

After making changes to graph-flow:

```bash
# Update the marketplace (pulls latest changes)
claude plugin marketplace update local

# Update the installed plugin
claude plugin update graph-flow@local
```

## Validation

To validate the plugin manifest:

```bash
claude plugin validate /Users/hailmary/Code/rollercoaster.dev/graph-flow
```

## Troubleshooting

### Plugin Not Showing Up

1. Verify the plugin is enabled:
   ```bash
   cat ~/.claude/settings.json | jq '.enabledPlugins["graph-flow@local"]'
   ```

2. Check the installation:
   ```bash
   ls -la ~/.claude/plugins/cache/local/graph-flow/
   ```

3. Restart Claude Code completely

### Skills Not Available

Skills and commands are loaded when Claude Code starts. After installing or updating the plugin, restart Claude Code for changes to take effect.
