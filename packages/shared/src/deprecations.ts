export interface DeprecatedToolResolution {
  name: string;
  args: Record<string, unknown>;
  warning?: string;
}

function getNumberArg(
  args: Record<string, unknown>,
  candidates: string[],
): number | undefined {
  for (const key of candidates) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Translate deprecated tool names to their v3 equivalents.
 * Returns the resolved name/args plus a warning message when remapped.
 */
export function resolveDeprecatedToolCall(
  name: string,
  args: Record<string, unknown>,
): DeprecatedToolResolution {
  if (name === "p-planget") {
    return {
      name: "p-progress",
      args,
      warning: "Tool 'p-planget' is deprecated; use 'p-progress'.",
    };
  }

  if (name === "p-step-update") {
    const stepId = typeof args.stepId === "string" ? args.stepId : undefined;
    const clear = args.clear === true;
    const status = args.status;

    if (stepId && clear) {
      return {
        name: "p-sync",
        args: { clearOverrides: [stepId] },
        warning:
          "Tool 'p-step-update' is deprecated; use 'p-sync' with clearOverrides.",
      };
    }

    if (
      stepId &&
      (status === "done" ||
        status === "in-progress" ||
        status === "not-started")
    ) {
      return {
        name: "p-sync",
        args: {
          manualOverrides: [{ stepId, status }],
        },
        warning:
          "Tool 'p-step-update' is deprecated; use 'p-sync' with manualOverrides.",
      };
    }

    return {
      name: "p-sync",
      args,
      warning: "Tool 'p-step-update' is deprecated; use 'p-sync'.",
    };
  }

  if (name === "a-from-milestone") {
    const number =
      getNumberArg(args, ["number", "milestone", "milestoneNumber"]) ?? 0;
    return {
      name: "a-import",
      args: { type: "milestone", number },
      warning: "Tool 'a-from-milestone' is deprecated; use 'a-import'.",
    };
  }

  if (name === "a-from-epic") {
    const number = getNumberArg(args, ["number", "epic", "epicNumber"]) ?? 0;
    return {
      name: "a-import",
      args: { type: "epic", number },
      warning: "Tool 'a-from-epic' is deprecated; use 'a-import'.",
    };
  }

  if (name === "a-start-issue") {
    const issueNumber =
      getNumberArg(args, ["issue", "issueNumber", "number"]) ?? undefined;
    const title =
      typeof args.title === "string" && args.title.trim().length > 0
        ? args.title.trim()
        : issueNumber
          ? `Issue #${issueNumber}`
          : "Issue";
    const description =
      typeof args.description === "string" ? args.description : undefined;

    return {
      name: "p-goal",
      args: { title, description, issueNumber },
      warning:
        "Tool 'a-start-issue' is deprecated; use 'p-goal' and 'c-update' directly.",
    };
  }

  return { name, args };
}
