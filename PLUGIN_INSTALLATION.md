# Installing graph-flow as a Local Plugin

graph-flow can be installed as a Claude Code plugin to make its skills and commands available across all your projects.

## Prerequisites

- Claude Code CLI installed and configured
- graph-flow cloned to your local machine
- Bun runtime installed (for running graph-flow)

**Note:** In the following instructions, replace these placeholders with your actual paths:
- `~/Code/local-plugins` - Your desired local plugins directory
- `~/Code/graph-flow` - Path to your graph-flow clone

## Installation

### 1. Create a Local Marketplace

```bash
# Create marketplace structure
mkdir -p ~/Code/local-plugins/plugins
cd ~/Code/local-plugins/plugins

# Create symlink to your graph-flow installation
# Replace ~/Code/graph-flow with your actual path
ln -s ~/Code/graph-flow graph-flow
```

### 2. Create Marketplace Manifest

Create `~/Code/local-plugins/.claude-plugin/marketplace.json`:

```json
{
  "name": "local",
  "description": "Local development plugins",
  "owner": {
    "name": "Your Name",
    "email": "your@email.com"
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
# Add the local marketplace (use your actual path)
claude plugin marketplace add ~/Code/local-plugins

# Install graph-flow from the local marketplace
# --scope user makes it available to all your projects
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
- `/auto-issue` - Autonomous issue-to-PR workflow
- `/auto-milestone` - Create milestone workflow
- `/work-on-issue` - Work on existing issue
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
- `/work-on-issue` - Work on existing issue
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

To validate the plugin manifest before installation:

```bash
# Replace with your actual path to graph-flow
claude plugin validate ~/Code/graph-flow
```

## Troubleshooting

### Plugin Not Showing Up

1. Verify the plugin is enabled:
   ```bash
   jq '.enabledPlugins["graph-flow@local"]' ~/.claude/settings.json
   # Expected output: true (if enabled) or false/null (if disabled)
   ```

2. Check the installation (path may vary by Claude Code version):
   ```bash
   ls -la ~/.claude/plugins/cache/local/graph-flow/
   # Should show the plugin files and directories
   ```

3. Restart Claude Code completely

### Skills Not Available

Skills and commands are loaded when Claude Code starts. After installing or updating the plugin, restart Claude Code for changes to take effect.

### Symlink Issues

If the symlink doesn't work, verify it points to the correct location:

```bash
ls -l ~/Code/local-plugins/plugins/graph-flow
# Should show: graph-flow -> /path/to/your/graph-flow
```

If broken, recreate with the absolute path:

```bash
cd ~/Code/local-plugins/plugins
rm graph-flow  # Remove broken symlink
ln -s /absolute/path/to/graph-flow graph-flow
```
