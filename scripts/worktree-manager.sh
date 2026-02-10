#!/usr/bin/env bash
#
# Worktree Manager for /auto-milestone
# Manages git worktrees for parallel issue development
#
# NOTE: State management via claude-knowledge has been removed.
# Git worktree commands (create, remove, list, path, rebase) remain functional.
# State tracking commands (status, update-status, sync, checkpoint, resume, etc.)
# are stubbed out and will log warnings.
#
# Dependencies:
# - git, gh, jq, bun (required)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
WORKTREE_BASE="$HOME/Code/worktrees"

# DISABLED: claude-knowledge package removed
# CLI_CMD="bun $REPO_ROOT/packages/claude-knowledge/src/cli.ts"
MILESTONE_ID_FILE="$WORKTREE_BASE/.milestone_id"

# Default timeouts and retry settings
CI_POLL_TIMEOUT=${CI_POLL_TIMEOUT:-1800}  # 30 minutes
CI_POLL_INTERVAL=${CI_POLL_INTERVAL:-30}  # 30 seconds base interval

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

#------------------------------------------------------------------------------
# Helper Functions
# log_info prints an informational message prefixed with `[worktree]` in blue.

log_info() { echo -e "${BLUE}[worktree]${NC} $1"; }
# log_success prints MESSAGE to stdout prefixed with "[worktree]" in green.
log_success() { echo -e "${GREEN}[worktree]${NC} $1"; }
# log_warn prints a warning message prefixed with [worktree] in yellow.
log_warn() { echo -e "${YELLOW}[worktree]${NC} $1"; }
# log_error prints an error message prefixed with "[worktree]" in red.
log_error() { echo -e "${RED}[worktree]${NC} $1"; }

#------------------------------------------------------------------------------
# CLI Helper Functions (DISABLED - claude-knowledge removed)

# cli_call is disabled - claude-knowledge package removed
cli_call() {
  log_warn "claude-knowledge removed - state management disabled"
  return 1
}

# get_milestone_id retrieves the cached milestone ID from file
get_milestone_id() {
  if [[ -f "$MILESTONE_ID_FILE" ]]; then
    cat "$MILESTONE_ID_FILE"
  else
    log_warn "No milestone ID found (state management disabled)."
    echo ""
  fi
}

# update_state is disabled - claude-knowledge package removed
update_state() {
  log_warn "claude-knowledge removed - state tracking disabled"
  return 0
}

# remove_from_state is disabled - claude-knowledge package removed
remove_from_state() {
  log_warn "claude-knowledge removed - state tracking disabled"
  return 0
}

# set_milestone_field is disabled - claude-knowledge package removed
set_milestone_field() {
  log_warn "claude-knowledge removed - milestone tracking disabled"
  return 0
}

# get_milestone_field is disabled - claude-knowledge package removed
get_milestone_field() {
  log_warn "claude-knowledge removed - milestone tracking disabled"
  echo ""
}

#------------------------------------------------------------------------------
# Prerequisite Checks

# check_prerequisites verifies that required CLI tools (git, gh, jq, bun) are available.
# Exits with error if any are missing.
check_prerequisites() {
  local missing=()

  for cmd in git gh jq bun; do
    if ! command -v "$cmd" &> /dev/null; then
      missing+=("$cmd")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required commands: ${missing[*]}"
    log_error "Please install missing dependencies and try again"
    exit 1
  fi
}

# ensure_base_dir ensures the worktree base directory exists
ensure_base_dir() {
  if [[ ! -d "$WORKTREE_BASE" ]]; then
    mkdir -p "$WORKTREE_BASE"
    log_info "Created worktree base directory: $WORKTREE_BASE"
  fi
}

# get_worktree_path returns the filesystem path for the worktree directory for the given issue number.
get_worktree_path() {
  local issue_number=$1
  echo "$WORKTREE_BASE/$REPO_NAME-issue-$issue_number"
}

#------------------------------------------------------------------------------
# Commands
# cmd_create creates a new git worktree for the specified issue (optionally using the provided branch name), installs dependencies in the worktree, and records the worktree and branch in the persistent state.

cmd_create() {
  check_prerequisites

  local issue_number=$1
  local branch_name=${2:-""}

  if [[ -z "$issue_number" ]]; then
    log_error "Usage: worktree-manager.sh create <issue-number> [branch-name]"
    exit 1
  fi

  ensure_base_dir

  local worktree_path
  worktree_path=$(get_worktree_path "$issue_number")

  if [[ -d "$worktree_path" ]]; then
    log_warn "Worktree for issue #$issue_number already exists at $worktree_path"
    exit 0
  fi

  # Fetch latest main
  log_info "Fetching latest from origin..."
  git -C "$REPO_ROOT" fetch origin main --quiet

  # Generate branch name if not provided
  if [[ -z "$branch_name" ]]; then
    # Get issue title for branch name
    local issue_title
    issue_title=$(gh issue view "$issue_number" --json title -q '.title' 2>/dev/null || echo "issue-$issue_number")
    # Sanitize title for branch name
    local sanitized
    sanitized=$(echo "$issue_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-40)
    branch_name="feat/issue-$issue_number-$sanitized"
  fi

  # Create worktree with new branch from origin/main
  log_info "Creating worktree for issue #$issue_number..."
  git -C "$REPO_ROOT" worktree add -b "$branch_name" "$worktree_path" origin/main --quiet

  # Install dependencies in worktree
  log_info "Installing dependencies in worktree..."
  (cd "$worktree_path" && bun install --silent)

  update_state "$issue_number" "running" "$branch_name"

  log_success "Created worktree for issue #$issue_number"
  echo "  Path: $worktree_path"
  echo "  Branch: $branch_name"
}

# cmd_remove removes the worktree for a given issue number, optionally deletes its branch if it is fully merged into main, and updates the tracked state.
cmd_remove() {
  local issue_number=$1

  if [[ -z "$issue_number" ]]; then
    log_error "Usage: worktree-manager.sh remove <issue-number>"
    exit 1
  fi

  local worktree_path
  worktree_path=$(get_worktree_path "$issue_number")

  if [[ ! -d "$worktree_path" ]]; then
    log_warn "No worktree found for issue #$issue_number"
    exit 0
  fi

  # Get branch name before removing (query worktree directly for reliability)
  local branch_name
  branch_name=$(git -C "$worktree_path" branch --show-current 2>/dev/null || echo "")

  log_info "Removing worktree for issue #$issue_number..."
  git -C "$REPO_ROOT" worktree remove "$worktree_path" --force

  # Optionally delete the branch if it exists and is fully merged
  if [[ -n "$branch_name" ]]; then
    if git -C "$REPO_ROOT" branch --merged main | grep -q "$branch_name"; then
      git -C "$REPO_ROOT" branch -d "$branch_name" 2>/dev/null || true
      log_info "Deleted merged branch: $branch_name"
    fi
  fi

  remove_from_state "$issue_number"
  log_success "Removed worktree for issue #$issue_number"
}

# cmd_list lists current git worktrees.
cmd_list() {
  ensure_base_dir

  echo ""
  echo "Git Worktrees:"
  echo "─────────────────────────────────────────────────────────────"
  git -C "$REPO_ROOT" worktree list
  echo ""
}

# cmd_path prints the filesystem path for the worktree corresponding to the given issue number; exits with status 1 if the issue number is missing or the worktree does not exist.
cmd_path() {
  local issue_number=$1

  if [[ -z "$issue_number" ]]; then
    log_error "Usage: worktree-manager.sh path <issue-number>"
    exit 1
  fi

  local worktree_path
  worktree_path=$(get_worktree_path "$issue_number")

  if [[ -d "$worktree_path" ]]; then
    echo "$worktree_path"
  else
    log_error "No worktree found for issue #$issue_number"
    exit 1
  fi
}

# cmd_rebase rebases the worktree for the specified issue onto origin/main; on conflict it aborts the rebase, reports an error, and returns a non-zero status.
cmd_rebase() {
  local issue_number=$1

  if [[ -z "$issue_number" ]]; then
    log_error "Usage: worktree-manager.sh rebase <issue-number>"
    exit 1
  fi

  local worktree_path
  worktree_path=$(get_worktree_path "$issue_number")

  if [[ ! -d "$worktree_path" ]]; then
    log_error "No worktree found for issue #$issue_number"
    exit 1
  fi

  log_info "Rebasing worktree for issue #$issue_number on main..."

  # Fetch latest
  git -C "$worktree_path" fetch origin main --quiet

  # Attempt rebase
  if git -C "$worktree_path" rebase origin/main --quiet; then
    log_success "Rebase successful for issue #$issue_number"
    return 0
  else
    log_error "Rebase failed - conflicts detected"
    git -C "$worktree_path" rebase --abort
    return 1
  fi
}

# cmd_ci_status checks CI status for a PR with optional blocking wait.
cmd_ci_status() {
  local pr_number=""
  local wait_flag=""

  # Parse arguments - handle flags in any position
  for arg in "$@"; do
    case "$arg" in
      --wait) wait_flag="--wait" ;;
      *) [[ -z "$pr_number" ]] && pr_number="$arg" ;;
    esac
  done

  if [[ -z "$pr_number" ]] || ! [[ "$pr_number" =~ ^[0-9]+$ ]]; then
    log_error "Usage: worktree-manager.sh ci-status <pr-number> [--wait]"
    exit 1
  fi

  check_prerequisites

  if [[ "$wait_flag" == "--wait" ]]; then
    log_info "Waiting for CI checks on PR #$pr_number (timeout: ${CI_POLL_TIMEOUT}s)..."

    local elapsed=0
    local interval=$CI_POLL_INTERVAL
    local max_interval=120  # Max 2 minutes between polls

    while [[ $elapsed -lt $CI_POLL_TIMEOUT ]]; do
      local status
      status=$(gh pr checks "$pr_number" --json name,state,conclusion 2>/dev/null || echo "[]")

      local pending in_progress completed failed
      pending=$(echo "$status" | jq '[.[] | select(.state == "PENDING")] | length')
      in_progress=$(echo "$status" | jq '[.[] | select(.state == "IN_PROGRESS")] | length')
      completed=$(echo "$status" | jq '[.[] | select(.state == "COMPLETED")] | length')
      failed=$(echo "$status" | jq '[.[] | select(.conclusion == "FAILURE")] | length')

      if [[ "$pending" -eq 0 ]] && [[ "$in_progress" -eq 0 ]]; then
        # All checks complete
        if [[ "$failed" -gt 0 ]]; then
          log_error "CI failed: $failed check(s) failed"
          echo "$status" | jq -r '.[] | select(.conclusion == "FAILURE") | "  - \(.name): \(.conclusion)"'
          return 1
        else
          log_success "All CI checks passed ($completed checks)"
          return 0
        fi
      fi

      printf "\r  Waiting... %ds elapsed, %d pending, %d in progress, %d complete" \
        "$elapsed" "$pending" "$in_progress" "$completed"

      sleep "$interval"
      elapsed=$((elapsed + interval))

      # Exponential backoff (capped)
      interval=$((interval * 2))
      if [[ $interval -gt $max_interval ]]; then
        interval=$max_interval
      fi
    done

    echo ""
    log_error "CI check timeout after ${CI_POLL_TIMEOUT}s"
    return 1
  else
    # Non-blocking status check
    local status
    status=$(gh pr checks "$pr_number" --json name,state,conclusion 2>/dev/null || echo "[]")

    local total pending in_progress completed passed failed
    total=$(echo "$status" | jq 'length')
    pending=$(echo "$status" | jq '[.[] | select(.state == "PENDING")] | length')
    in_progress=$(echo "$status" | jq '[.[] | select(.state == "IN_PROGRESS")] | length')
    completed=$(echo "$status" | jq '[.[] | select(.state == "COMPLETED")] | length')
    passed=$(echo "$status" | jq '[.[] | select(.conclusion == "SUCCESS")] | length')
    failed=$(echo "$status" | jq '[.[] | select(.conclusion == "FAILURE")] | length')

    echo ""
    echo "CI Status for PR #$pr_number:"
    printf "  %-15s %d\n" "Total checks:" "$total"
    printf "  %-15s %d\n" "Pending:" "$pending"
    printf "  %-15s %d\n" "In progress:" "$in_progress"
    printf "  %-15s %d\n" "Completed:" "$completed"
    printf "  %-15s %d\n" "Passed:" "$passed"
    printf "  %-15s %d\n" "Failed:" "$failed"
    echo ""

    # Return JSON for scripting
    jq -n \
      --argjson total "$total" \
      --argjson pending "$pending" \
      --argjson in_progress "$in_progress" \
      --argjson completed "$completed" \
      --argjson passed "$passed" \
      --argjson failed "$failed" \
      '{total: $total, pending: $pending, in_progress: $in_progress, completed: $completed, passed: $passed, failed: $failed}'
  fi
}

# cmd_integration_test runs full validation on main after all PRs are merged.
cmd_integration_test() {
  check_prerequisites

  log_info "Running post-merge integration tests on main..."

  # Ensure we're on main with latest
  git -C "$REPO_ROOT" fetch origin main --quiet
  git -C "$REPO_ROOT" checkout main --quiet 2>/dev/null || {
    log_error "Cannot checkout main - you may have uncommitted changes"
    exit 1
  }
  git -C "$REPO_ROOT" pull origin main --quiet

  local results=()
  local exit_code=0

  # Type-check
  log_info "Running type-check..."
  if (cd "$REPO_ROOT" && bun run type-check); then
    results+=("type-check: PASS")
  else
    results+=("type-check: FAIL")
    exit_code=1
  fi

  # Lint
  log_info "Running lint..."
  if (cd "$REPO_ROOT" && bun run lint); then
    results+=("lint: PASS")
  else
    results+=("lint: FAIL")
    exit_code=1
  fi

  # Unit tests
  log_info "Running tests..."
  if (cd "$REPO_ROOT" && bun test); then
    results+=("test: PASS")
  else
    results+=("test: FAIL")
    exit_code=1
  fi

  # Build
  log_info "Running build..."
  if (cd "$REPO_ROOT" && bun run build); then
    results+=("build: PASS")
  else
    results+=("build: FAIL")
    exit_code=1
  fi

  echo ""
  echo "┌─────────────────────────────────────────────────────────────┐"
  echo "│              Integration Test Results                       │"
  echo "└─────────────────────────────────────────────────────────────┘"
  echo ""
  for result in "${results[@]}"; do
    if [[ "$result" == *"PASS"* ]]; then
      echo -e "  ${GREEN}✓${NC} $result"
    else
      echo -e "  ${RED}✗${NC} $result"
    fi
  done
  echo ""

  if [[ $exit_code -eq 0 ]]; then
    log_success "All integration tests passed!"
  else
    log_error "Integration tests failed. Manual intervention required."
  fi

  return $exit_code
}

# cmd_cleanup_all prompts for confirmation (unless --force) and removes all tracked worktrees.
cmd_cleanup_all() {
  local force_flag=""

  for arg in "$@"; do
    case "$arg" in
      --force) force_flag="--force" ;;
    esac
  done

  ensure_base_dir

  # List worktrees matching our pattern
  local worktrees
  worktrees=$(git -C "$REPO_ROOT" worktree list --porcelain | grep "worktree" | grep "$REPO_NAME-issue-" | sed 's/worktree //' || true)

  if [[ -z "$worktrees" ]]; then
    log_info "No worktrees to remove"
    exit 0
  fi

  local count
  count=$(echo "$worktrees" | wc -l | tr -d ' ')

  if [[ "$force_flag" != "--force" ]]; then
    log_warn "This will remove $count worktree(s). Are you sure? (y/N)"
    read -r confirm

    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      log_info "Aborted"
      exit 0
    fi
  fi

  local failed_count=0
  while read -r worktree_path; do
    if [[ -n "$worktree_path" ]]; then
      local issue_number
      issue_number=$(basename "$worktree_path" | sed "s/$REPO_NAME-issue-//")
      if ! cmd_remove "$issue_number"; then
        ((failed_count++)) || true
      fi
    fi
  done <<< "$worktrees"

  if [[ $failed_count -gt 0 ]]; then
    log_warn "Cleanup completed with $failed_count failure(s)"
    exit 1
  else
    log_success "All worktrees removed"
  fi
}

# cmd_help prints the usage message and a list of available commands.
cmd_help() {
  cat << 'EOF'
Worktree Manager for /auto-milestone

NOTE: State management (via claude-knowledge) has been disabled.
Git worktree commands remain fully functional.

Usage: worktree-manager.sh <command> [arguments]

Worktree Commands:
  create <issue> [branch]   Create a new worktree for an issue
  remove <issue>            Remove a worktree and optionally its branch
  list                      List all worktrees
  path <issue>              Print the path to a worktree
  rebase <issue>            Rebase a worktree on main
  cleanup-all [--force]     Remove all worktrees (--force skips confirmation)

CI Commands:
  ci-status <pr> [--wait]   Check CI status for a PR (--wait blocks until complete)
  integration-test          Run full test suite on main after all merges

Environment Variables:
  CI_POLL_TIMEOUT   Timeout for CI wait in seconds (default: 1800)
  CI_POLL_INTERVAL  Base interval between CI polls (default: 30)

Examples:
  worktree-manager.sh create 111
  worktree-manager.sh create 111 feat/my-custom-branch
  worktree-manager.sh remove 111
  worktree-manager.sh ci-status 145 --wait
  worktree-manager.sh integration-test
  worktree-manager.sh cleanup-all --force
EOF
}

#------------------------------------------------------------------------------
# Main
# main parses the first CLI argument as a subcommand and dispatches to the corresponding cmd_* function, defaulting to help.

main() {
  local command=${1:-help}
  shift || true

  case "$command" in
    # Worktree commands
    create)        cmd_create "$@" ;;
    remove)        cmd_remove "$@" ;;
    list)          cmd_list ;;
    path)          cmd_path "$@" ;;
    rebase)        cmd_rebase "$@" ;;
    cleanup-all)   cmd_cleanup_all "$@" ;;

    # CI commands
    ci-status)     cmd_ci_status "$@" ;;
    integration-test) cmd_integration_test ;;

    help|--help|-h) cmd_help ;;
    *)
      log_error "Unknown command: $command"
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
