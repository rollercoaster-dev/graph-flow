import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AutomationMCPTools } from "@graph-flow/automation";
import { CheckpointMCPTools } from "@graph-flow/checkpoint";
import { DocsMCPTools } from "@graph-flow/docs";
import { GraphMCPTools } from "@graph-flow/graph";
import { KnowledgeMCPTools } from "@graph-flow/knowledge";
import { PlanningMCPTools } from "@graph-flow/planning";

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCliTools(
  scriptPath: string,
  projectDir: string,
  cwd: string,
): Promise<CliRunResult> {
  const proc = Bun.spawn(["bun", "run", scriptPath, "tools"], {
    cwd,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
  return {
    exitCode: proc.exitCode,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

describe("CLI/MCP parity", () => {
  const testRoot = "/tmp/graph-flow-test-cli-parity";
  const scriptPath = join(import.meta.dir, "../src/index.ts");
  const repoRoot = join(import.meta.dir, "../../..");

  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  test("CLI tools exactly match MCP subsystem tools", async () => {
    const workflowsDir = join(testRoot, "workflows");
    const learningsDir = join(testRoot, "learnings");
    const embeddingsDir = join(testRoot, "embeddings");
    const graphsDir = join(testRoot, "graphs");
    const docsDir = join(testRoot, "docs");
    const planningDir = join(testRoot, "planning");

    const checkpoint = new CheckpointMCPTools(workflowsDir);
    const knowledge = new KnowledgeMCPTools(learningsDir, embeddingsDir);
    const graph = new GraphMCPTools(graphsDir);
    const docs = new DocsMCPTools(docsDir, embeddingsDir);
    const planning = new PlanningMCPTools(planningDir);

    await checkpoint.init();
    await knowledge.init();
    await graph.init();
    await docs.init();
    await planning.init();

    const automation = new AutomationMCPTools(planning.getManager());
    await automation.init();

    const expected = new Set([
      ...checkpoint.getTools().map((t) => t.name),
      ...knowledge.getTools().map((t) => t.name),
      ...graph.getTools().map((t) => t.name),
      ...docs.getTools().map((t) => t.name),
      ...planning.getTools().map((t) => t.name),
      ...automation.getTools().map((t) => t.name),
    ]);

    const cli = await runCliTools(scriptPath, testRoot, repoRoot);
    expect(cli.exitCode).toBe(0);

    const cliNames = new Set(
      (JSON.parse(cli.stdout) as Array<{ name: string }>).map((t) => t.name),
    );

    expect(cliNames).toEqual(expected);
    expect(cliNames.size).toBe(26);
  });
});
