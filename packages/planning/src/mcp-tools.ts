/**
 * Planning MCP Tools
 *
 * MCP tool definitions for the planning stack system.
 * 8 tools: p-goal, p-interrupt, p-done, p-stack, p-plan, p-steps, p-progress, p-sync
 *
 * Removed:
 * - p-planget: merged into p-progress (which now returns plan + steps + metrics)
 * - p-step-update: folded into p-sync as manualOverrides/clearOverrides params
 */

import { PlanningManager } from "./manager";
import { computePlanProgress } from "./progress";
import { ResolverFactory } from "./resolvers";
import { detectStaleItems } from "./stale";
import type {
  ExternalRef,
  Plan,
  PlanSourceType,
  StackCompletionSummary,
  StaleItem,
} from "./types";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

/**
 * MCP tools for planning operations
 */
export class PlanningMCPTools {
  private manager: PlanningManager;
  private resolverFactory!: ResolverFactory;
  private initialized = false;

  constructor(storageDir: string) {
    this.manager = new PlanningManager(storageDir);
  }

  async init(): Promise<void> {
    await this.manager.init();
    this.resolverFactory = new ResolverFactory(this.manager.getStorage());
    this.initialized = true;
  }

  /**
   * Get the underlying PlanningManager for shared access.
   */
  getManager(): PlanningManager {
    this.ensureInitialized();
    return this.manager;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("PlanningMCPTools not initialized. Call init() first.");
    }
  }

  /**
   * Get all MCP tool definitions
   */
  getTools(): MCPTool[] {
    return [
      {
        name: "p-goal",
        description:
          "Push a new goal onto the planning stack. The current top item becomes paused.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the goal",
            },
            description: {
              type: "string",
              description: "Optional description of the goal",
            },
            issueNumber: {
              type: "number",
              description: "Optional linked GitHub issue number",
            },
            planStepId: {
              type: "string",
              description: "Optional link to a plan step",
            },
          },
          required: ["title"],
        },
      },
      {
        name: "p-interrupt",
        description:
          "Push an interrupt onto the stack (context switch). Links to interrupted item.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the interrupt",
            },
            reason: {
              type: "string",
              description: "Why this interrupt happened",
            },
          },
          required: ["title", "reason"],
        },
      },
      {
        name: "p-done",
        description:
          "Pop the top item from the stack (mark as completed). Returns summary and resumed item.",
        inputSchema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Optional summary of what was accomplished",
            },
          },
        },
      },
      {
        name: "p-stack",
        description:
          "Get the current planning stack state. Set includeStale=true to check for stale items (slower, requires GitHub API calls).",
        inputSchema: {
          type: "object",
          properties: {
            includeStale: {
              type: "boolean",
              description:
                "Include stale item detection (default: false for faster response)",
            },
          },
        },
      },
      {
        name: "p-plan",
        description: "Create a Plan linked to a Goal.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Plan title",
            },
            goalId: {
              type: "string",
              description: "ID of the goal this plan is for",
            },
            sourceType: {
              type: "string",
              enum: ["milestone", "epic", "manual"],
              description: "Source type for the plan",
            },
            sourceRef: {
              type: "string",
              description: "Optional source reference (milestone number, etc.)",
            },
          },
          required: ["title", "goalId", "sourceType"],
        },
      },
      {
        name: "p-steps",
        description: "Add steps to a Plan.",
        inputSchema: {
          type: "object",
          properties: {
            planId: {
              type: "string",
              description: "ID of the plan to add steps to",
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Step title" },
                  ordinal: { type: "number", description: "Execution order" },
                  wave: {
                    type: "number",
                    description: "Parallelization group",
                  },
                  externalRef: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string",
                        enum: ["issue", "manual"],
                        description: "External reference type",
                      },
                      number: {
                        type: "number",
                        description: "GitHub issue number (for issue type)",
                      },
                      criteria: {
                        type: "string",
                        description: "Completion criteria (for manual type)",
                      },
                    },
                    required: ["type"],
                  },
                  dependsOn: {
                    type: "array",
                    items: { type: "string" },
                    description: "IDs of steps this depends on",
                  },
                },
                required: ["title", "ordinal", "wave", "externalRef"],
              },
              description: "Array of steps to add",
            },
          },
          required: ["planId", "steps"],
        },
      },
      {
        name: "p-progress",
        description:
          "Get a Plan with its steps and progress metrics. Returns plan, steps, and computed progress in one response. Requires either goalId or planId.",
        inputSchema: {
          type: "object",
          properties: {
            planId: {
              type: "string",
              description: "ID of the plan to get progress for",
            },
            goalId: {
              type: "string",
              description: "ID of the goal (alternative to planId)",
            },
          },
        },
      },
      {
        name: "p-sync",
        description:
          "Force-refresh all issue-type steps from GitHub. Optionally set manual status overrides or clear them.",
        inputSchema: {
          type: "object",
          properties: {
            planId: {
              type: "string",
              description: "Sync specific plan (optional)",
            },
            goalId: {
              type: "string",
              description: "Alternative to planId, sync plan for this goal",
            },
            manualOverrides: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  stepId: {
                    type: "string",
                    description: "The step ID to override",
                  },
                  status: {
                    type: "string",
                    enum: ["done", "in-progress", "not-started"],
                    description: "Status to set",
                  },
                },
                required: ["stepId", "status"],
              },
              description:
                "Manually set step statuses, overriding external sources",
            },
            clearOverrides: {
              type: "array",
              items: { type: "string" },
              description:
                "Step IDs to clear manual overrides from (reverts to external source)",
            },
          },
        },
      },
    ];
  }

  /**
   * Handle MCP tool call
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    this.ensureInitialized();
    switch (name) {
      case "p-goal":
        return this.handleGoal(args);
      case "p-interrupt":
        return this.handleInterrupt(args);
      case "p-done":
        return this.handleDone(args);
      case "p-stack":
        return this.handleStack(args);
      case "p-plan":
        return this.handlePlan(args);
      case "p-steps":
        return this.handleSteps(args);
      case "p-progress":
        return this.handleProgress(args);
      case "p-sync":
        return this.handleSync(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleGoal(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { title, description, issueNumber, planStepId } = args as {
      title: string;
      description?: string;
      issueNumber?: number;
      planStepId?: string;
    };

    const { goal, stack } = await this.manager.pushGoal({
      title,
      description,
      issueNumber,
      planStepId,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              goal,
              stack: {
                depth: stack.depth,
                topItem: stack.topItem,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleInterrupt(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { title, reason } = args as {
      title: string;
      reason: string;
    };

    const { interrupt, interruptedItem, stack } =
      await this.manager.pushInterrupt({
        title,
        reason,
      });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              interrupt,
              interruptedItem,
              stack: {
                depth: stack.depth,
                topItem: stack.topItem,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleDone(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { summary: userSummary } = args as { summary?: string };

    const { completed, resumed, stack } = await this.manager.popStack();

    if (!completed) {
      return {
        content: [
          {
            type: "text",
            text: "Stack is empty - nothing to complete.",
          },
        ],
      };
    }

    // Calculate duration
    const durationMs = Date.now() - new Date(completed.createdAt).getTime();
    const durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 10) / 10;

    const completionSummary: StackCompletionSummary = {
      item: completed,
      summary:
        userSummary ||
        `Completed ${completed.type}: ${completed.title} (${durationHours}h)`,
      durationMs,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              completed: completionSummary,
              resumed,
              stack: {
                depth: stack.depth,
                topItem: stack.topItem,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleStack(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { includeStale = false } = args as { includeStale?: boolean };

    const stack = this.manager.peekStack();
    let staleItems: StaleItem[] = [];

    if (includeStale) {
      staleItems = await detectStaleItems(this.manager, this.resolverFactory);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              stack: {
                items: stack.items,
                depth: stack.depth,
                topItem: stack.topItem,
              },
              staleItems: staleItems.length > 0 ? staleItems : undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handlePlan(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { title, goalId, sourceType, sourceRef } = args as {
      title: string;
      goalId: string;
      sourceType: PlanSourceType;
      sourceRef?: string;
    };

    // Verify goal exists
    const goal = this.manager.getEntity(goalId);
    if (!goal) {
      return {
        content: [
          {
            type: "text",
            text: `Goal not found: ${goalId}`,
          },
        ],
      };
    }

    // Check if plan already exists for this goal
    const existingPlan = this.manager.getPlanByGoal(goalId);
    if (existingPlan) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Plan already exists for this goal",
                existingPlan,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const plan = await this.manager.createPlan({
      title,
      goalId,
      sourceType,
      sourceRef,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ plan }, null, 2),
        },
      ],
    };
  }

  private async handleSteps(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { planId, steps: stepsInput } = args as {
      planId: string;
      steps: Array<{
        title: string;
        ordinal: number;
        wave: number;
        externalRef: ExternalRef;
        dependsOn?: string[];
      }>;
    };

    // Verify plan exists
    const plan = this.manager.getPlan(planId);
    if (!plan) {
      return {
        content: [
          {
            type: "text",
            text: `Plan not found: ${planId}`,
          },
        ],
      };
    }

    const steps = await this.manager.createSteps(planId, stepsInput);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              plan,
              steps,
              count: steps.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  /**
   * Merged handler: returns plan + steps + progress metrics in one response.
   * Replaces both the old p-planget (plan + steps) and p-progress (metrics only).
   */
  private async handleProgress(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { planId, goalId } = args as {
      planId?: string;
      goalId?: string;
    };

    let plan: Plan | null = null;

    if (planId) {
      plan = this.manager.getPlan(planId);
    } else if (goalId) {
      plan = this.manager.getPlanByGoal(goalId);
    }

    if (!plan) {
      return {
        content: [
          {
            type: "text",
            text: "Plan not found. Provide either goalId or planId.",
          },
        ],
      };
    }

    const steps = this.manager.getStepsByPlan(plan.id);
    const progress = await computePlanProgress(
      plan,
      steps,
      this.resolverFactory,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              plan,
              steps,
              stepCount: steps.length,
              progress,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  /**
   * Enhanced sync handler: refreshes from GitHub and optionally applies/clears
   * manual status overrides (previously handled by p-step-update).
   */
  private async handleSync(
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { planId, goalId, manualOverrides, clearOverrides } = args as {
      planId?: string;
      goalId?: string;
      manualOverrides?: Array<{
        stepId: string;
        status: "done" | "in-progress" | "not-started";
      }>;
      clearOverrides?: string[];
    };

    // Apply manual overrides first (before sync)
    const overrideResults: Array<{
      stepId: string;
      action: string;
      result: string;
    }> = [];

    if (clearOverrides && clearOverrides.length > 0) {
      for (const stepId of clearOverrides) {
        const step = this.manager.getStep(stepId);
        if (!step) {
          overrideResults.push({
            stepId,
            action: "clear",
            result: "step not found",
          });
          continue;
        }
        await this.manager.clearStepStatus(stepId);
        overrideResults.push({ stepId, action: "clear", result: "ok" });
      }
    }

    if (manualOverrides && manualOverrides.length > 0) {
      for (const override of manualOverrides) {
        const step = this.manager.getStep(override.stepId);
        if (!step) {
          overrideResults.push({
            stepId: override.stepId,
            action: "set",
            result: "step not found",
          });
          continue;
        }
        await this.manager.setStepStatus(override.stepId, override.status);
        overrideResults.push({
          stepId: override.stepId,
          action: `set:${override.status}`,
          result: "ok",
        });
      }
    }

    // If goalId provided, resolve to planId
    let targetPlanId = planId;
    if (goalId && !planId) {
      const plan = this.manager.getPlanByGoal(goalId);
      if (!plan) {
        return {
          content: [
            {
              type: "text",
              text: `No plan found for goal: ${goalId}`,
            },
          ],
        };
      }
      targetPlanId = plan.id;
    }

    // Sync from GitHub
    const syncResults = await this.manager.syncFromGitHub(targetPlanId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sync: syncResults,
              overrides:
                overrideResults.length > 0 ? overrideResults : undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
