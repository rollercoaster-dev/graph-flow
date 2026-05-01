# Host Setup Guide

This guide explains how to use graph-flow from any host environment.

## Integration Model

graph-flow has four layers:

- `MCP server`: the primary tool surface for hosts that support stdio MCP servers
- `CLI`: the fallback and scripting surface when MCP is unavailable
- `Codex plugin`: optional Codex-native UX layer for workflow skills
- `Claude Code plugin`: optional Claude-specific UX layer for skills, commands, and hooks

The portable core remains MCP + CLI. Host-specific plugins sit above that core.

## One-Time Prerequisites

```bash
bun install
gh --version
gh auth status
```

Optional for neural embeddings:

- `OPENAI_API_KEY`, or
- `OPENROUTER_API_KEY`

Without those, docs and knowledge search use TF-IDF fallback.

## Project Setup

From the project root:

```bash
graph-flow init
graph-flow doctor
```

`graph-flow init` now does three things:

- creates project-local storage under `.claude/`
- writes or updates `.mcp.json`
- prints the merged MCP config for inspection

## Host Matrix

### Claude Code

- Install the plugin if you want skills, slash commands, and hooks
- Run `/graph-flow:init` or `graph-flow init` in each project
- Restart Claude Code after `.mcp.json` changes

### Codex

- Install the repo or personal Codex plugin if you want first-class workflow skills
- Use the `graph-flow init` skill or run `graph-flow init --codex` in the project
- Use repo-scoped `.codex/agents/` only when you explicitly want delegated or parallel agent work
- If you do not install the plugin, graph-flow still works through MCP + CLI

### Another MCP-capable host

- Run `graph-flow init` in the project
- Ensure the host loads stdio MCP servers from the project `.mcp.json`
- If the host requires explicit server registration, use the generated config snippet

### Hosts without MCP support

Use the CLI directly:

```bash
graph-flow tools | jq '.[].name'
graph-flow c-find --json '{}'
graph-flow g-calls --json '{"name":"main"}'
graph-flow d-index --json '{}'
```

## What To Validate

```bash
graph-flow doctor --doctor-json
```

Key checks:

- Bun is available
- `gh` is installed and authenticated
- `.mcp.json` contains a `graph-flow` server entry
- `CLAUDE_PROJECT_DIR` points at the current project
- the project directory is writable

If the plugin runtime is absent, that is expected outside Claude Code and does not block CLI or MCP usage.

## Recommended Positioning

Treat graph-flow as:

- `core`: MCP server + CLI
- `optional host UX`: Codex plugin or Claude plugin

That keeps the tool surface portable across agent hosts while still giving Codex and Claude first-class workflow ergonomics on top.
