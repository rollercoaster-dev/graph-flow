#!/usr/bin/env python3
"""
graph-flow session check hook.

Runs on UserPromptSubmit to verify the project has MCP tools configured.
Outputs context to help Claude know whether tools are available.
"""

import json
import os
import sys


def find_mcp_config() -> str | None:
    """Find .mcp.json in the current project directory."""
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    mcp_path = os.path.join(project_dir, ".mcp.json")
    if os.path.isfile(mcp_path):
        return mcp_path
    return None


def has_graph_flow_entry(mcp_path: str) -> bool:
    """Check if .mcp.json has a graph-flow server entry."""
    try:
        with open(mcp_path) as f:
            config = json.load(f)
        servers = config.get("mcpServers", {})
        return "graph-flow" in servers
    except (json.JSONDecodeError, OSError):
        return False


def main() -> None:
    mcp_path = find_mcp_config()

    if mcp_path and has_graph_flow_entry(mcp_path):
        # Tools are configured — output a brief reference card
        print(
            "graph-flow MCP tools available: "
            "c- (checkpoint), k- (knowledge), g- (graph), p- (planning), a- (automation). "
            "Use ToolSearch to discover specific tools."
        )
    else:
        # Not configured — guide the user
        print(
            "graph-flow MCP tools are NOT configured for this project. "
            "Run `/graph-flow:init` to set up MCP tools, then restart Claude Code."
        )


if __name__ == "__main__":
    main()
