import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateBoardConfig } from "@graph-flow/automation";

export interface DoctorOptions {
  projectRoot?: string;
}

type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  summary: string;
  details?: string;
}

export interface DoctorResult {
  ok: boolean;
  projectRoot: string;
  checks: DoctorCheck[];
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function runCommand(args: string[]): Promise<CommandResult> {
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return {
      ok: proc.exitCode === 0,
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function isWritableDir(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function statusIcon(status: DoctorStatus): string {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const checks: DoctorCheck[] = [];

  // Runtime
  checks.push(
    process.versions.bun
      ? {
          id: "runtime-bun",
          status: "pass",
          summary: `Bun detected (${process.versions.bun})`,
        }
      : {
          id: "runtime-bun",
          status: "fail",
          summary: "Bun runtime not detected",
          details: "Run graph-flow with Bun.",
        },
  );

  // gh CLI
  const ghVersion = await runCommand(["gh", "--version"]);
  if (ghVersion.ok) {
    checks.push({
      id: "gh-installed",
      status: "pass",
      summary: "GitHub CLI is installed",
    });
  } else {
    checks.push({
      id: "gh-installed",
      status: "fail",
      summary: "GitHub CLI is not available",
      details:
        ghVersion.stderr.trim() || "Install `gh` and ensure it is in PATH.",
    });
  }

  // gh auth
  if (ghVersion.ok) {
    const ghAuth = await runCommand(["gh", "auth", "status"]);
    checks.push(
      ghAuth.ok
        ? {
            id: "gh-auth",
            status: "pass",
            summary: "GitHub CLI is authenticated",
          }
        : {
            id: "gh-auth",
            status: "warn",
            summary: "GitHub CLI auth not ready",
            details:
              ghAuth.stderr.trim() ||
              "Run `gh auth login` for automation features.",
          },
    );
  }

  // MCP config
  const mcpPath = join(projectRoot, ".mcp.json");
  let mcpFound = false;
  let mcpValid = false;
  try {
    const text = await Bun.file(mcpPath).text();
    if (text.trim().length > 0) {
      const json = JSON.parse(text) as {
        mcpServers?: {
          "graph-flow"?: { env?: { CLAUDE_PROJECT_DIR?: string } };
        };
      };
      mcpFound = true;
      mcpValid = Boolean(json.mcpServers?.["graph-flow"]);
      const configuredProject =
        json.mcpServers?.["graph-flow"]?.env?.CLAUDE_PROJECT_DIR;
      if (!mcpValid) {
        checks.push({
          id: "mcp-entry",
          status: "fail",
          summary: ".mcp.json missing graph-flow server entry",
          details: "Run `graph-flow init` or `/graph-flow:init`.",
        });
      } else if (
        configuredProject &&
        resolve(configuredProject) !== projectRoot
      ) {
        checks.push({
          id: "mcp-project-dir",
          status: "warn",
          summary: "CLAUDE_PROJECT_DIR differs from current project",
          details: `Configured: ${configuredProject}\nCurrent: ${projectRoot}`,
        });
      } else {
        checks.push({
          id: "mcp-entry",
          status: "pass",
          summary: "MCP graph-flow server entry is configured",
        });
      }
    }
  } catch {
    // Handled below
  }

  if (!mcpFound) {
    checks.push({
      id: "mcp-file",
      status: "warn",
      summary: ".mcp.json not found",
      details: "Run `graph-flow init` or `/graph-flow:init` to configure MCP.",
    });
  }

  // Data dir
  const dataDir = join(projectRoot, ".claude");
  const writable = await isWritableDir(projectRoot);
  checks.push(
    writable
      ? {
          id: "project-write",
          status: "pass",
          summary: "Project directory is writable",
          details: `Data directory: ${dataDir}`,
        }
      : {
          id: "project-write",
          status: "fail",
          summary: "Project directory is not writable",
          details: `Cannot write to ${projectRoot}`,
        },
  );

  // Plugin hooks
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    checks.push({
      id: "plugin-root",
      status: "warn",
      summary: "CLAUDE_PLUGIN_ROOT not set",
      details:
        "Hook checks skipped. This is expected outside Claude plugin runtime.",
    });
  } else {
    const hooksPath = join(pluginRoot, "hooks", "hooks.json");
    const startHook = join(pluginRoot, "hooks", "session-start.py");
    const checkHook = join(pluginRoot, "hooks", "session-check.py");
    const hooksReady =
      (await Bun.file(hooksPath).exists()) &&
      (await Bun.file(startHook).exists()) &&
      (await Bun.file(checkHook).exists());
    checks.push(
      hooksReady
        ? {
            id: "hooks",
            status: "pass",
            summary: "Plugin hooks are present",
          }
        : {
            id: "hooks",
            status: "warn",
            summary: "Plugin hooks missing",
            details: `Expected files under ${join(pluginRoot, "hooks")}`,
          },
    );
  }

  // Board automation config
  const boardValidation = validateBoardConfig(projectRoot);
  checks.push(
    boardValidation.ok
      ? {
          id: "board-config",
          status: "pass",
          summary: "Board automation config is valid",
          details: boardValidation.path,
        }
      : {
          id: "board-config",
          status: "warn",
          summary: "Board automation config is incomplete",
          details: boardValidation.message,
        },
  );

  // Embeddings provider
  if (process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY) {
    checks.push({
      id: "embeddings-provider",
      status: "pass",
      summary: "Neural embeddings provider key detected",
    });
  } else {
    checks.push({
      id: "embeddings-provider",
      status: "warn",
      summary: "No OPENAI_API_KEY or OPENROUTER_API_KEY set",
      details: "Docs/knowledge search will use TF-IDF fallback.",
    });
  }

  const hasFail = checks.some((c) => c.status === "fail");
  return {
    ok: !hasFail,
    projectRoot,
    checks,
  };
}

export function formatDoctorResult(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push("graph-flow doctor");
  lines.push(`Project: ${result.projectRoot}`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`[${statusIcon(check.status)}] ${check.summary}`);
    if (check.details) {
      lines.push(`  ${check.details}`);
    }
  }

  lines.push("");
  lines.push(result.ok ? "Doctor result: OK" : "Doctor result: FAIL");
  return lines.join("\n");
}
