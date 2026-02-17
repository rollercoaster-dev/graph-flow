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

CONTEXT = """graph-flow MCP tools active. These answer different questions than grep/glob/LSP:

GRAPH TOOLS (run g-index first to populate the cache)
g-index: Index code files before using other g- tools. Run once per session on packages you'll work in.
g-calls: "What directly calls this function?" Structured caller data across the full indexed codebase — faster and more complete than grep.
g-blast: "What breaks if I change X?" Traces the full transitive call graph. Use BEFORE modifying any shared function, type, or class.
g-defs: "What is defined in this file?" All functions, classes, interfaces with line numbers.

DOCS GRAPH TOOLS (run d-index first)
d-index: Index markdown files into the docs graph. Pass glob patterns e.g. ['docs/**/*.md', 'README.md']. Extracts hierarchical sections and builds DOCUMENTS relationships (backtick identifiers in docs → code entities).
d-query: Semantic search over indexed doc sections.
d-for-code: "What docs exist for function X?" Traverses DOCUMENTS relationships built during d-index.

KNOWLEDGE TOOLS
k-query: "What do I already know about this area?" Run at the start of any non-trivial task, before opening files.
k-store: "This was non-obvious." Capture gotchas, patterns, architectural decisions not in the code.
k-index: Index markdown as session learnings (separate from docs graph — stores as searchable learnings).
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
