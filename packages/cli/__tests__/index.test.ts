import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  scriptPath: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<CliRunResult> {
  const proc = Bun.spawn(["bun", "run", scriptPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
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

async function waitForPath(path: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await access(path);
      return true;
    } catch {
      await Bun.sleep(100);
    }
  }
  return false;
}

describe("graph-flow CLI", () => {
  let projectDir: string;
  const scriptPath = join(import.meta.dir, "../src/index.ts");
  const repoRoot = join(import.meta.dir, "../../..");

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "graph-flow-cli-project-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  test("tools includes docs MCP tools", async () => {
    const result = await runCli(
      scriptPath,
      ["tools"],
      { CLAUDE_PROJECT_DIR: projectDir },
      repoRoot,
    );

    expect(result.exitCode).toBe(0);

    const tools = JSON.parse(result.stdout) as Array<{ name: string }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain("d-index");
    expect(names).toContain("d-query");
    expect(names).toContain("d-for-code");
  });

  test("init --background creates data directories in target project", async () => {
    const result = await runCli(
      scriptPath,
      [
        "init",
        "--project",
        projectDir,
        "--skip-code",
        "--skip-docs",
        "--background",
      ],
      { CLAUDE_PROJECT_DIR: projectDir },
      repoRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "graph-flow initialization started in background",
    );

    // The background child should execute init and create the data directories.
    const workflowsReady = await waitForPath(
      join(projectDir, ".claude", "workflows"),
      5000,
    );
    const planningReady = await waitForPath(
      join(projectDir, ".claude", "planning"),
      5000,
    );
    expect(workflowsReady).toBe(true);
    expect(planningReady).toBe(true);
  });

  test("deprecated tool aliases are routed", async () => {
    const result = await runCli(
      scriptPath,
      ["p-planget", "--json", "{}"],
      { CLAUDE_PROJECT_DIR: projectDir },
      repoRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Plan not found");
    expect(result.stderr).toContain("deprecated");
  });

  test("doctor emits machine-readable report", async () => {
    const result = await runCli(
      scriptPath,
      ["doctor", "--project", projectDir, "--doctor-json"],
      { CLAUDE_PROJECT_DIR: projectDir },
      repoRoot,
    );

    const report = JSON.parse(result.stdout) as {
      projectRoot: string;
      checks: Array<{ id: string; status: string }>;
    };
    expect(report.projectRoot).toBe(projectDir);
    expect(report.checks.length).toBeGreaterThan(0);
  });
});
