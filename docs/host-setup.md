# Host Setup Guide

This guide explains how to use graph-flow from any host environment.

## Integration Model

graph-flow has three layers:

- `MCP server`: the primary tool surface for hosts that support stdio MCP servers
- `CLI`: the fallback and scripting surface when MCP is unavailable
- `Claude Code plugin`: optional UX layer for skills, commands, and hooks

The plugin is not required to use graph-flow tools.

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

### Codex or another MCP-capable host

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
- `optional`: Claude plugin

That keeps the tool surface portable across agent hosts and makes the plugin a convenience layer instead of a requirement.
