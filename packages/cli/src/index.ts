#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { CheckpointMCPTools } from "@graph-flow/checkpoint";
import { KnowledgeMCPTools } from "@graph-flow/knowledge";
import { GraphMCPTools } from "@graph-flow/graph";
import { PlanningMCPTools } from "@graph-flow/planning";
import { AutomationMCPTools } from "@graph-flow/automation";
import { runInit, formatInitResult, type InitOptions } from "./init.ts";

function resolveBaseDir(): string {
  const explicit = process.env.GRAPH_FLOW_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR?.trim();
  if (projectDir) {
    return join(projectDir, ".claude");
  }
  return join(homedir(), ".claude");
}

function printHelp(): void {
  const text = `graph-flow CLI

Usage:
  graph-flow init [--skip-code] [--skip-docs] [--project <path>]
  graph-flow tools
  graph-flow <tool> [--json '{...}'] [--file path] [--pretty]

Commands:
  init                Initialize graph-flow for a project
  tools               List available MCP tools

Init options:
  --skip-code         Skip code indexing
  --skip-docs         Skip docs indexing
  --project <path>    Project root (default: current directory)

Examples:
  graph-flow init
  graph-flow init --skip-code
  graph-flow checkpoint-find --json '{"issue": 123}'
  graph-flow knowledge-store --file ./learning.json
  cat ./args.json | graph-flow graph-calls

Environment:
  GRAPH_FLOW_DIR      Use a custom base storage directory
  CLAUDE_PROJECT_DIR  Uses $CLAUDE_PROJECT_DIR/.claude
`;
  console.log(text);
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseJson(text: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
    throw new Error("JSON must be an object");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: "string" },
      file: { type: "string" },
      pretty: { type: "boolean" },
      help: { type: "boolean" },
      "skip-code": { type: "boolean" },
      "skip-docs": { type: "boolean" },
      project: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const tool = positionals[0];
  if (!tool) {
    printHelp();
    process.exit(1);
  }

  // Handle init command
  if (tool === "init") {
    const initOptions: InitOptions = {
      projectRoot: values.project,
      indexCode: !values["skip-code"],
      indexDocs: !values["skip-docs"],
    };
    const result = await runInit(initOptions);
    console.log(formatInitResult(result));
    return;
  }

  const baseDir = resolveBaseDir();
  const workflowsDir = join(baseDir, "workflows");
  const learningsDir = join(baseDir, "learnings");
  const embeddingsDir = join(baseDir, "embeddings");
  const graphsDir = join(baseDir, "graphs");
  const planningDir = join(baseDir, "planning");

  const checkpoint = new CheckpointMCPTools(workflowsDir);
  const knowledge = new KnowledgeMCPTools(learningsDir, embeddingsDir);
  const graph = new GraphMCPTools(graphsDir);
  const planning = new PlanningMCPTools(planningDir);

  await checkpoint.init();
  await knowledge.init();
  await graph.init();
  await planning.init();

  const automation = new AutomationMCPTools(
    planning.getManager(),
    checkpoint.getManager()
  );
  await automation.init();

  if (tool === "tools") {
    const tools = [
      ...checkpoint.getTools(),
      ...knowledge.getTools(),
      ...graph.getTools(),
      ...planning.getTools(),
      ...automation.getTools(),
    ];
    console.log(JSON.stringify(tools, null, values.pretty ? 2 : 0));
    return;
  }

  let args: Record<string, unknown> = {};
  if (values.json) {
    args = parseJson(values.json, "--json");
  } else if (values.file) {
    const content = await Bun.file(values.file).text();
    args = parseJson(content, values.file);
  } else if (!process.stdin.isTTY) {
    const content = await readStdin();
    if (content.trim()) {
      args = parseJson(content, "stdin");
    }
  }

  let result;
  if (tool.startsWith("checkpoint-")) {
    result = await checkpoint.handleToolCall(tool, args);
  } else if (tool.startsWith("knowledge-")) {
    result = await knowledge.handleToolCall(tool, args);
  } else if (tool.startsWith("graph-")) {
    result = await graph.handleToolCall(tool, args);
  } else if (tool.startsWith("planning-")) {
    result = await planning.handleToolCall(tool, args);
  } else if (tool.startsWith("automation-")) {
    result = await automation.handleToolCall(tool, args);
  } else {
    throw new Error(`Unknown tool: ${tool}`);
  }

  const text = result?.content?.[0]?.text ?? "";
  if (values.pretty) {
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
      return;
    } catch {
      // Fall through if not JSON
    }
  }
  console.log(text);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
