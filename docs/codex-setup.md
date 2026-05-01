# Codex Setup Guide

This guide configures graph-flow for Codex using the repo-local Codex plugin, workflow skills, and the existing graph-flow MCP/CLI core.

For the broader cross-host model, see [docs/host-setup.md](./host-setup.md).

## 1) Install the repo-local Codex plugin

This repository now includes:

- a repo marketplace at `.agents/plugins/marketplace.json`
- a local Codex plugin at `plugins/graph-flow/`
- repo-scoped custom agents at `.codex/agents/`

In Codex:

1. Open the Plugin Directory.
2. Select the repo marketplace for this repository.
3. Install `graph-flow`.
4. Restart Codex if the new skills do not appear immediately.

The main Codex-native workflow skills are:

- `graph-flow init`
- `graph-flow auto-issue`
- `graph-flow work-on-issue`
- `graph-flow auto-merge`

The phase skills are also available for advanced use:

- `graph-flow setup`
- `graph-flow implement`
- `graph-flow review`
- `graph-flow finalize`

Invoke them explicitly by typing `$` in the composer and selecting the graph-flow skill you want.

## 2) Install and verify dependencies

```bash
bun install
gh --version
gh auth status
```

## 3) Bootstrap graph-flow for this repository

From your project root:

```bash
graph-flow init --codex
```

This creates project-local storage under `.claude/`, writes or updates `.mcp.json`, and writes a project-scoped `.codex/config.toml` block for the graph-flow MCP server.

You can do the same setup through Codex by invoking the `graph-flow init` skill from the plugin.

## 4) Validate setup with doctor

```bash
graph-flow doctor
```

Use JSON output for scripting:

```bash
graph-flow doctor --doctor-json
```

## 5) Configure board automation (required for `a-board-update`)

Copy `.graph-flow.json.example` to `.graph-flow.json` and fill board IDs:

```bash
cp .graph-flow.json.example .graph-flow.json
```

Required fields:

- `board.projectId`
- `board.fieldId`
- `board.orgLogin`
- `board.projectNumber`
- `board.statusOptions.Backlog`
- `board.statusOptions.Next`
- `board.statusOptions.In Progress`
- `board.statusOptions.Blocked`
- `board.statusOptions.Done`

You can override any field with environment variables:
`BOARD_PROJECT_ID`, `BOARD_FIELD_ID`, `BOARD_ORG_LOGIN`,
`BOARD_PROJECT_NUMBER`, `BOARD_OPT_BACKLOG`, `BOARD_OPT_NEXT`,
`BOARD_OPT_IN_PROGRESS`, `BOARD_OPT_BLOCKED`, `BOARD_OPT_DONE`.

## 6) Optional: enable custom Codex agents

This repo ships project-scoped custom agents in `.codex/agents/` and wires them into `.codex/config.toml` via `agents.<role>.config_file`. Codex loads them automatically once you point Codex at this repo's config. The wired roles are:

- `issue_worker`
- `pr_reviewer`
- `docs_researcher`

Use them only when you explicitly want delegation or parallel work. The workflow skills do not require them.

If you maintain your own `.codex/config.toml` outside this repo, you can either point Codex at the repo's `config.toml` or copy the `[agents.*]` blocks into your own file and adjust the `config_file` paths.

## 7) Optional: enable neural embeddings

Set one provider key:

- `OPENAI_API_KEY`, or
- `OPENROUTER_API_KEY`

Without these, docs/knowledge search runs on TF-IDF fallback.

## 8) Smoke test commands

```bash
graph-flow tools | jq '.[].name'
graph-flow c-find --json '{}'
graph-flow g-calls --json '{"name":"main"}'
graph-flow d-index --json '{}'
```

If your Codex host does not expose project MCP servers yet, use these CLI commands directly as the integration fallback.

## 9) Recommended Codex usage model

- Prefer the plugin skills for workflow entry points.
- Rely on graph-flow MCP tools as the core integration surface once setup is complete.
- Fall back to the `graph-flow` CLI when MCP is unavailable.
- Reserve repo-scoped custom agents for explicit delegated work, not as a hidden dependency.

## 10) CI consistency checks

Run before opening PRs:

```bash
bun run lint
bun run validate:references
bun test
```
