#!/usr/bin/env bash
#
# CI Utilities for /auto-milestone and /auto-epic
# Provides rebase, CI polling, and integration test commands.
#
# Worktree lifecycle (create, remove, list, cleanup) is handled by
# Claude Code's built-in `isolation: "worktree"` on Task calls.
#
# Dependencies:
# - git, gh, jq, bun (required)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

log_info() { echo -e "${BLUE}[ci-utils]${NC} $1"; }
log_success() { echo -e "${GREEN}[ci-utils]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[ci-utils]${NC} $1"; }
log_error() { echo -e "${RED}[ci-utils]${NC} $1"; }

# check_commands verifies that specified CLI tools are available.
# Exits with error if any are missing.
check_commands() {
  local missing=()

  for cmd in "$@"; do
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

check_prerequisites() {
  check_commands git gh jq bun
}

# validate_issue_number ensures the argument is a positive integer (digits only).
# Prevents path traversal via ../ or / in issue number arguments.
validate_issue_number() {
  local issue_number="${1:-}"
  if [[ -z "$issue_number" ]]; then
    return 1
  fi
  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log_error "Invalid issue number: '$issue_number' (must be a positive integer)"
    return 1
  fi
  if (( 10#$issue_number <= 0 )); then
    log_error "Invalid issue number: '$issue_number' (must be greater than 0)"
    return 1
  fi
}

# fetch_pr_checks queries gh for CI check status and parses counts in a single jq call.
# Sets global variables: _checks_raw, _checks_total, _checks_pending, _checks_in_progress,
# _checks_completed, _checks_passed, _checks_failed.
# Returns non-zero on gh or jq failure.
fetch_pr_checks() {
  local pr_number=$1

  if ! _checks_raw=$(gh pr checks "$pr_number" --json name,state,bucket 2>&1); then
    log_error "Failed to query CI status: $_checks_raw"
    return 1
  fi

  local parsed
  if ! parsed=$(echo "$_checks_raw" | jq '{
    total: length,
    pending: [.[] | select(.state == "PENDING")] | length,
    in_progress: [.[] | select(.state == "IN_PROGRESS")] | length,
    completed: [.[] | select(.state == "COMPLETED")] | length,
    passed: [.[] | select(.bucket == "pass")] | length,
    failed: [.[] | select(.bucket == "fail")] | length
  }' 2>&1); then
    log_error "Received invalid JSON from gh pr checks: $_checks_raw"
    return 1
  fi

  _checks_total=$(echo "$parsed" | jq '.total')
  _checks_pending=$(echo "$parsed" | jq '.pending')
  _checks_in_progress=$(echo "$parsed" | jq '.in_progress')
  _checks_completed=$(echo "$parsed" | jq '.completed')
  _checks_passed=$(echo "$parsed" | jq '.passed')
  _checks_failed=$(echo "$parsed" | jq '.failed')
}

#------------------------------------------------------------------------------
# Commands

# cmd_rebase rebases the current branch onto origin/main.
# Assumes the correct branch is already checked out (e.g., inside an isolation worktree).
# On conflict it aborts the rebase and returns a non-zero status.
cmd_rebase() {
  check_commands git

  local issue_number="${1:-}"

  if ! validate_issue_number "$issue_number"; then
    log_error "Usage: ci-utils.sh rebase <issue-number>"
    exit 1
  fi

  log_info "Rebasing current branch on origin/main (issue #$issue_number)..."

  # Fetch latest
  git fetch origin main --quiet

  # Attempt rebase
  if git rebase origin/main --quiet; then
    log_success "Rebase successful for issue #$issue_number"
    return 0
  else
    log_error "Rebase failed - conflicts detected"
    if ! git rebase --abort; then
      log_error "CRITICAL: rebase --abort also failed. Run 'git rebase --abort' or 'git rebase --quit' manually."
    fi
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
    log_error "Usage: ci-utils.sh ci-status <pr-number> [--wait]"
    exit 1
  fi

  check_commands git gh jq

  if [[ "$wait_flag" == "--wait" ]]; then
    log_info "Waiting for CI checks on PR #$pr_number (timeout: ${CI_POLL_TIMEOUT}s)..."

    local elapsed=0
    local interval=$CI_POLL_INTERVAL
    local max_interval=120  # Max 2 minutes between polls

    while [[ $elapsed -lt $CI_POLL_TIMEOUT ]]; do
      if ! fetch_pr_checks "$pr_number"; then
        return 1
      fi

      # Guard: 0 total checks means checks haven't registered yet — keep waiting
      if [[ "$_checks_total" -eq 0 ]]; then
        printf "\r  Waiting... %ds elapsed, no checks registered yet" "$elapsed"
        sleep "$interval"
        elapsed=$((elapsed + interval))
        interval=$((interval * 2))
        if [[ $interval -gt $max_interval ]]; then interval=$max_interval; fi
        continue
      fi

      if [[ "$_checks_pending" -eq 0 ]] && [[ "$_checks_in_progress" -eq 0 ]]; then
        # All checks complete
        if [[ "$_checks_failed" -gt 0 ]]; then
          log_error "CI failed: $_checks_failed check(s) failed"
          echo "$_checks_raw" | jq -r '.[] | select(.bucket == "fail") | "  - \(.name): \(.state)"'
          return 1
        else
          log_success "All CI checks passed ($_checks_completed checks)"
          return 0
        fi
      fi

      printf "\r  Waiting... %ds elapsed, %d pending, %d in progress, %d complete" \
        "$elapsed" "$_checks_pending" "$_checks_in_progress" "$_checks_completed"

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
    if ! fetch_pr_checks "$pr_number"; then
      return 1
    fi

    # Human-readable summary to stderr
    echo "" >&2
    echo "CI Status for PR #$pr_number:" >&2
    printf "  %-15s %d\n" "Total checks:" "$_checks_total" >&2
    printf "  %-15s %d\n" "Pending:" "$_checks_pending" >&2
    printf "  %-15s %d\n" "In progress:" "$_checks_in_progress" >&2
    printf "  %-15s %d\n" "Completed:" "$_checks_completed" >&2
    printf "  %-15s %d\n" "Passed:" "$_checks_passed" >&2
    printf "  %-15s %d\n" "Failed:" "$_checks_failed" >&2
    echo "" >&2

    # JSON to stdout for scripting
    jq -n \
      --argjson total "$_checks_total" \
      --argjson pending "$_checks_pending" \
      --argjson in_progress "$_checks_in_progress" \
      --argjson completed "$_checks_completed" \
      --argjson passed "$_checks_passed" \
      --argjson failed "$_checks_failed" \
      '{total: $total, pending: $pending, in_progress: $in_progress, completed: $completed, passed: $passed, failed: $failed}'
  fi
}

# cmd_integration_test runs full validation on main after all PRs are merged.
cmd_integration_test() {
  check_prerequisites

  log_info "Running post-merge integration tests on main..."

  # Save current branch to restore after tests
  local original_branch
  original_branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  if [[ -z "$original_branch" ]]; then
    log_warn "Could not determine current branch (detached HEAD?). You will be left on main after tests."
  fi

  # Register cleanup trap to restore branch on any exit (including set -e failures)
  _restore_original_branch() {
    if [[ -n "${original_branch:-}" && "$original_branch" != "main" ]]; then
      git -C "$REPO_ROOT" checkout "$original_branch" --quiet 2>/dev/null || \
        log_warn "Could not restore branch '$original_branch' — still on main"
    fi
  }
  trap _restore_original_branch EXIT

  # Ensure we're on main with latest
  git -C "$REPO_ROOT" fetch origin main --quiet
  if ! git -C "$REPO_ROOT" checkout main --quiet; then
    log_error "Cannot checkout main. Check git error above — may be uncommitted changes, corrupted index, or missing ref."
    exit 1
  fi
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

  # Branch restoration handled by EXIT trap (_restore_original_branch)
  return $exit_code
}

cmd_help() {
  cat << 'EOF'
CI Utilities for /auto-milestone and /auto-epic

Worktree lifecycle is handled by Claude Code's built-in isolation: "worktree".
This script provides CI polling, rebase, and integration test commands.

Usage: ci-utils.sh <command> [arguments]

Commands:
  rebase <issue>            Rebase current branch on origin/main
  ci-status <pr> [--wait]   Check CI status for a PR (--wait blocks until complete)
  integration-test          Run full test suite on main after all merges

Environment Variables:
  CI_POLL_TIMEOUT   Timeout for CI wait in seconds (default: 1800)
  CI_POLL_INTERVAL  Base interval between CI polls (default: 30)

Examples:
  ci-utils.sh rebase 111
  ci-utils.sh ci-status 145 --wait
  ci-utils.sh integration-test
EOF
}

#------------------------------------------------------------------------------
# Main

main() {
  local command=${1:-help}
  shift || true

  case "$command" in
    rebase)           cmd_rebase "$@" ;;
    ci-status)        cmd_ci_status "$@" ;;
    integration-test) cmd_integration_test ;;
    help|--help|-h)   cmd_help ;;
    *)
      log_error "Unknown command: $command"
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
