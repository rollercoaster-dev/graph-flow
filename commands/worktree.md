# Worktree Manager

Manage git worktrees for parallel Claude Code sessions.

Worktrees are stored at `~/Code/worktrees/<repo>-issue-<N>` (outside the repo).

## Usage

Run the worktree manager script with the provided arguments:

```bash
"$CLAUDE_PROJECT_DIR/scripts/worktree-manager.sh" $ARGUMENTS
```

## Available Commands

- `create <issue> [branch]` - Create a new worktree for a GitHub issue
- `status` - Show status of all worktrees
- `list` - List all worktrees
- `remove <issue>` - Remove a worktree
- `sync` - Sync state file with actual git worktrees
- `help` - Show help

## Examples

```
/worktree create 164
/worktree create 164 feat/sqlite-api-key
/worktree status
/worktree remove 164
```

## Worktree Location

Worktrees are created at: `~/Code/worktrees/monorepo-issue-<N>`

This keeps worktrees outside the main repo to avoid nesting issues.

## Workflow

1. Create worktrees for issues you want to work on in parallel
2. Open a new terminal for each worktree
3. Run `claude` in each worktree directory
4. Each Claude session works independently on its issue
5. Use `/worktree status` in any session to see all active work
