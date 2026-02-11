# Worktree Manager

Manage git worktrees for parallel Claude Code sessions.

Worktrees are stored at `~/Code/worktrees/<repo>-issue-<N>` (outside the repo).

## Usage

Run the worktree manager script with the provided arguments:

```bash
"$CLAUDE_PROJECT_DIR/scripts/worktree-manager.sh" $ARGUMENTS
```

## Available Commands

### Worktree Commands

- `create <issue> [branch]` - Create a new worktree for a GitHub issue
- `remove <issue>` - Remove a worktree and optionally its merged branch
- `list` - List all worktrees
- `path <issue>` - Print the filesystem path for a worktree
- `rebase <issue>` - Rebase a worktree onto origin/main
- `cleanup-all [--force]` - Remove all worktrees (`--force` skips confirmation)

### CI Commands

- `ci-status <pr> [--wait]` - Check CI status for a PR (`--wait` blocks until complete)
- `integration-test` - Run full test suite on main after all merges

- `help` - Show help

## Examples

```bash
/worktree create 164
/worktree create 164 feat/sqlite-api-key
/worktree path 164
/worktree rebase 164
/worktree remove 164
/worktree cleanup-all --force
/worktree ci-status 42 --wait
/worktree integration-test
```

## Worktree Location

Worktrees are created at: `~/Code/worktrees/graph-flow-issue-<N>`

This keeps worktrees outside the main repo to avoid nesting issues.

## Workflow

1. Create worktrees for issues you want to work on in parallel
2. Open a new terminal for each worktree
3. Run `claude` in each worktree directory
4. Each Claude session works independently on its issue
5. Use `/worktree status` in any session to see all active work
