#!/usr/bin/env python3
"""
graph-flow SessionStart hook.

Outputs behavioral context for graph/docs/knowledge tools as additionalContext JSON.
Only fires when the project has .mcp.json with a graph-flow entry — silent otherwise
(UserPromptSubmit hook handles the "not configured" case).

Output format matches the explanatory-output-style plugin's SessionStart mechanism:
  { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }
"""

import json
import os

CONTEXT = """graph-flow MCP tools are active. Prefer these over grep/glob/LSP for the use cases below.

GRAPH TOOLS — no setup needed, auto-detect source files
INSTEAD OF grepping for callers: use g-calls(name: "myFunction")
INSTEAD OF manually tracing impact: use g-blast(name: "MyClass") — full transitive call graph
INSTEAD OF reading a file to find its exports: use g-defs(file: "src/foo.ts")
g-index: Pre-warm cache for large codebases. Omit to let g-calls/g-blast parse on-demand.

DOCS GRAPH TOOLS — no args needed, auto-detects *.md
INSTEAD OF grepping docs: use d-query(query: "how does auth work")
INSTEAD OF searching for which docs cover a function: use d-for-code(name: "handleLogin")
d-index: Run once to index docs. No args required — auto-discovers all *.md files.

KNOWLEDGE TOOLS
BEFORE opening files on any non-trivial task: k-query(query: "area you're about to work in")
AFTER a non-obvious discovery: k-store(content: "what you learned", codeArea: "package/file")
k-index: Index a markdown file as session learnings.
k-related: Find learnings related to a given learning by ID."""


def find_mcp_config() -> str | None:
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    mcp_path = os.path.join(project_dir, ".mcp.json")
    return mcp_path if os.path.isfile(mcp_path) else None


def has_graph_flow_entry(mcp_path: str) -> bool:
    try:
        with open(mcp_path) as f:
            config = json.load(f)
        return "graph-flow" in config.get("mcpServers", {})
    except (json.JSONDecodeError, OSError):
        return False


def main() -> None:
    mcp_path = find_mcp_config()
    if not (mcp_path and has_graph_flow_entry(mcp_path)):
        # Not configured — silent. UserPromptSubmit hook handles the setup guidance.
        print("{}")
        return

    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": CONTEXT,
        }
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
