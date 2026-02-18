import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBoardConfig, validateBoardConfig } from "../board-config";

const BOARD_ENV_KEYS = [
  "BOARD_PROJECT_ID",
  "BOARD_FIELD_ID",
  "BOARD_ORG_LOGIN",
  "BOARD_PROJECT_NUMBER",
  "BOARD_OPT_BACKLOG",
  "BOARD_OPT_NEXT",
  "BOARD_OPT_IN_PROGRESS",
  "BOARD_OPT_BLOCKED",
  "BOARD_OPT_DONE",
] as const;

describe("board config", () => {
  let projectDir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "graph-flow-board-config-"));
    for (const key of BOARD_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
    for (const key of BOARD_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("fails validation when no config exists", () => {
    const result = validateBoardConfig(projectDir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(".graph-flow.json");
    expect(result.missing.length).toBeGreaterThan(0);
  });

  test("loads config from .graph-flow.json", async () => {
    await writeFile(
      join(projectDir, ".graph-flow.json"),
      JSON.stringify(
        {
          board: {
            projectId: "PVT_project",
            fieldId: "FIELD_status",
            orgLogin: "rollercoaster-dev",
            projectNumber: 11,
            statusOptions: {
              Backlog: "opt-backlog",
              Next: "opt-next",
              "In Progress": "opt-in-progress",
              Blocked: "opt-blocked",
              Done: "opt-done",
            },
          },
        },
        null,
        2,
      ),
    );

    const config = getBoardConfig(projectDir);
    expect(config.projectId).toBe("PVT_project");
    expect(config.statusOptions["In Progress"]).toBe("opt-in-progress");
  });

  test("env vars override file config", async () => {
    await writeFile(
      join(projectDir, ".graph-flow.json"),
      JSON.stringify(
        {
          board: {
            projectId: "PVT_project",
            fieldId: "FIELD_status",
            orgLogin: "rollercoaster-dev",
            projectNumber: 11,
            statusOptions: {
              Backlog: "opt-backlog",
              Next: "opt-next",
              "In Progress": "opt-in-progress",
              Blocked: "opt-blocked",
              Done: "opt-done",
            },
          },
        },
        null,
        2,
      ),
    );

    process.env.BOARD_PROJECT_ID = "PVT_from_env";
    process.env.BOARD_OPT_DONE = "opt-done-env";

    const config = getBoardConfig(projectDir);
    expect(config.projectId).toBe("PVT_from_env");
    expect(config.statusOptions.Done).toBe("opt-done-env");
  });
});
