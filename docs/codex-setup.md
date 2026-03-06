# Codex Setup Guide

This guide configures graph-flow for Codex and other non-plugin hosts.

For the broader cross-host model, see [docs/host-setup.md](./host-setup.md).

## 1) Install and verify dependencies

```bash
bun install
gh --version
gh auth status
```

## 2) Configure MCP for this repository

From your project root:

```bash
graph-flow init
```

This creates project-local storage under `.claude/` and writes or updates `.mcp.json`.

## 3) Validate setup with doctor

```bash
graph-flow doctor
```

Use JSON output for scripting:

```bash
graph-flow doctor --doctor-json
```

## 4) Configure board automation (required for `a-board-update`)

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

## 5) Optional: enable neural embeddings

Set one provider key:

- `OPENAI_API_KEY`, or
- `OPENROUTER_API_KEY`

Without these, docs/knowledge search runs on TF-IDF fallback.

## 6) Smoke test commands

```bash
graph-flow tools | jq '.[].name'
graph-flow c-find --json '{}'
graph-flow g-calls --json '{"name":"main"}'
graph-flow d-index --json '{}'
```

If your Codex host does not expose project MCP servers yet, use these CLI commands directly as the integration fallback.

## 7) CI consistency checks

Run before opening PRs:

```bash
bun run lint
bun run validate:references
bun test
```
