#!/usr/bin/env bash
echo "MOVED: worktree-manager.sh renamed to ci-utils.sh" >&2
exec "$(dirname "$0")/ci-utils.sh" "$@"
