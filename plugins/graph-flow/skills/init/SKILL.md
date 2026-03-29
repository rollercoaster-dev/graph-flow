---
name: init
description: Bootstrap graph-flow for Codex in the current repository. Use when the user wants graph-flow tools available in Codex, needs MCP setup checked, or hits missing-tool errors before using graph-flow workflows.
---

# graph-flow Init

Bootstrap graph-flow for Codex without relying on Claude slash commands.

## Workflow

1. Work from the repository root.
2. Prefer the installed `graph-flow` CLI. If it is unavailable, fall back to `bunx @graph-flow/cli`.
3. Run initialization:
   `graph-flow init`
4. Verify setup:
   `graph-flow doctor`
5. If MCP still is not available in Codex, explain the exact next step:
   - use the repo-local `.mcp.json` that `graph-flow init` wrote, or
   - register the server through Codex MCP settings / `codex mcp add`
6. End with a concise status summary:
   - whether init succeeded
   - whether doctor passed
   - whether graph-flow MCP tools should now be usable

## Notes

- Prefer graph-flow MCP tools once available.
- Do not make unrelated repo changes during setup.
- If setup fails, report the concrete failing command and stop.
