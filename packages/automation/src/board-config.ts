import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type BoardStatus =
  | "Backlog"
  | "Next"
  | "In Progress"
  | "Blocked"
  | "Done";

export interface BoardConfig {
  projectId: string;
  fieldId: string;
  orgLogin: string;
  projectNumber: number;
  statusOptions: Record<BoardStatus, string>;
}

interface ProjectConfigFile {
  board?: {
    projectId?: string;
    fieldId?: string;
    orgLogin?: string;
    projectNumber?: number;
    statusOptions?: Partial<Record<BoardStatus, string>>;
  };
}

const REQUIRED_STATUS_OPTIONS: BoardStatus[] = [
  "Backlog",
  "Next",
  "In Progress",
  "Blocked",
  "Done",
];

export interface BoardConfigValidation {
  ok: boolean;
  path: string;
  missing: string[];
  config?: BoardConfig;
  message: string;
}

function resolveProjectRoot(projectRoot?: string): string {
  const raw = projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  return resolve(raw);
}

function loadProjectConfig(projectRoot: string): ProjectConfigFile {
  const path = join(projectRoot, ".graph-flow.json");
  if (!existsSync(path)) {
    return {};
  }

  try {
    const text = readFileSync(path, "utf-8");
    return text.trim().length > 0
      ? (JSON.parse(text) as ProjectConfigFile)
      : {};
  } catch {
    return {};
  }
}

function parseProjectNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) {
      return n;
    }
  }
  return undefined;
}

export function validateBoardConfig(
  projectRoot?: string,
): BoardConfigValidation {
  const root = resolveProjectRoot(projectRoot);
  const path = join(root, ".graph-flow.json");
  const file = loadProjectConfig(root);
  const board = file.board ?? {};

  const projectId = process.env.BOARD_PROJECT_ID ?? board.projectId;
  const fieldId = process.env.BOARD_FIELD_ID ?? board.fieldId;
  const orgLogin = process.env.BOARD_ORG_LOGIN ?? board.orgLogin;
  const projectNumber = parseProjectNumber(
    process.env.BOARD_PROJECT_NUMBER ?? board.projectNumber,
  );

  const statusOptions: Partial<Record<BoardStatus, string>> = {
    Backlog:
      process.env.BOARD_OPT_BACKLOG ??
      board.statusOptions?.Backlog ??
      undefined,
    Next: process.env.BOARD_OPT_NEXT ?? board.statusOptions?.Next ?? undefined,
    "In Progress":
      process.env.BOARD_OPT_IN_PROGRESS ??
      board.statusOptions?.["In Progress"] ??
      undefined,
    Blocked:
      process.env.BOARD_OPT_BLOCKED ??
      board.statusOptions?.Blocked ??
      undefined,
    Done: process.env.BOARD_OPT_DONE ?? board.statusOptions?.Done ?? undefined,
  };

  const missing: string[] = [];
  if (!projectId) missing.push("board.projectId / BOARD_PROJECT_ID");
  if (!fieldId) missing.push("board.fieldId / BOARD_FIELD_ID");
  if (!orgLogin) missing.push("board.orgLogin / BOARD_ORG_LOGIN");
  if (!projectNumber) {
    missing.push("board.projectNumber / BOARD_PROJECT_NUMBER");
  }

  for (const status of REQUIRED_STATUS_OPTIONS) {
    if (!statusOptions[status]) {
      missing.push(`board.statusOptions.${status} / BOARD_OPT_*`);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      path,
      missing,
      message:
        `Board config is missing required fields.\n` +
        `Create ${path} with a "board" object (or set BOARD_* env vars).\n` +
        `Missing:\n- ${missing.join("\n- ")}`,
    };
  }

  if (!projectId || !fieldId || !orgLogin || !projectNumber) {
    throw new Error("Board config validation failed unexpectedly");
  }
  const resolvedStatusOptions = {} as Record<BoardStatus, string>;
  for (const status of REQUIRED_STATUS_OPTIONS) {
    const value = statusOptions[status];
    if (!value) {
      throw new Error(
        `Board config status option missing unexpectedly: ${status}`,
      );
    }
    resolvedStatusOptions[status] = value;
  }

  return {
    ok: true,
    path,
    missing: [],
    config: {
      projectId,
      fieldId,
      orgLogin,
      projectNumber,
      statusOptions: resolvedStatusOptions,
    },
    message: `Board config loaded from ${path} and/or BOARD_* env vars.`,
  };
}

export function getBoardConfig(projectRoot?: string): BoardConfig {
  const validation = validateBoardConfig(projectRoot);
  if (!validation.ok || !validation.config) {
    throw new Error(validation.message);
  }
  return validation.config;
}
