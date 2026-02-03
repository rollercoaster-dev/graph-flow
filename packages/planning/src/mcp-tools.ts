/**
 * Planning MCP Tools
 *
 * MCP tool definitions for the planning stack system.
 * 8 tools: planning-goal, planning-interrupt, planning-done, planning-stack,
 * planning-plan, planning-steps, planning-planget, planning-progress
 */

import { PlanningManager } from "./manager";
import { ResolverFactory } from "./resolvers";
import { computePlanProgress } from "./progress";
import { detectStaleItems } from "./stale";
import type {
  PlanningStack,
  Plan,
  PlanStep,
  PlanProgress,
  StaleItem,
  PlanSourceType,
  ExternalRef,
  StackCompletionSummary,
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

  constructor(storageDir: string) {
    this.manager = new PlanningManager(storageDir);
  }

  async init(): Promise<void> {
    await this.manager.init();
    this.resolverFactory = new ResolverFactory(this.manager.getStorage());
  }

  /**
   * Get all MCP tool definitions
   */
  getTools(): MCPTool[] {
    return [
      {
        name: "planning-goal",
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
        name: "planning-interrupt",
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
        name: "planning-done",
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
        name: "planning-stack",
        description:
          "Get the current planning stack state with stale item detection.",
        inputSchema: {
          type: "object",
          properties: {
            includeStale: {
              type: "boolean",
              description: "Include stale item detection (default: true)",
            },
          },
        },
      },
      {
        name: "planning-plan",
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
        name: "planning-steps",
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
                  wave: { type: "number", description: "Parallelization group" },
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
        name: "planning-planget",
        description: "Get a Plan and its steps by Goal ID.",
        inputSchema: {
          type: "object",
          properties: {
            goalId: {
              type: "string",
              description: "ID of the goal to get plan for",
            },
            planId: {
              type: "string",
              description: "ID of the plan (alternative to goalId)",
            },
          },
        },
      },
      {
        name: "planning-progress",
        description: "Get progress metrics for a Plan.",
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
    ];
  }

  /**
   * Handle MCP tool call
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    switch (name) {
      case "planning-goal":
        return this.handleGoal(args);
      case "planning-interrupt":
        return this.handleInterrupt(args);
      case "planning-done":
        return this.handleDone(args);
      case "planning-stack":
        return this.handleStack(args);
      case "planning-plan":
        return this.handlePlan(args);
      case "planning-steps":
        return this.handleSteps(args);
      case "planning-planget":
        return this.handlePlanGet(args);
      case "planning-progress":
        return this.handleProgress(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleGoal(args: Record<string, unknown>): Promise<MCPToolResult> {
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
            2
          ),
        },
      ],
    };
  }

  private async handleInterrupt(
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const { title, reason } = args as {
      title: string;
      reason: string;
    };

    const { interrupt, interruptedItem, stack } = await this.manager.pushInterrupt(
      {
        title,
        reason,
      }
    );

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
            2
          ),
        },
      ],
    };
  }

  private async handleDone(args: Record<string, unknown>): Promise<MCPToolResult> {
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
    const durationMs =
      new Date().getTime() - new Date(completed.createdAt).getTime();
    const durationHours = Math.round(durationMs / (1000 * 60 * 60) * 10) / 10;

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
            2
          ),
        },
      ],
    };
  }

  private async handleStack(
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const { includeStale = true } = args as { includeStale?: boolean };

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
            2
          ),
        },
      ],
    };
  }

  private async handlePlan(args: Record<string, unknown>): Promise<MCPToolResult> {
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
              2
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
    args: Record<string, unknown>
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
            2
          ),
        },
      ],
    };
  }

  private async handlePlanGet(
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const { goalId, planId } = args as {
      goalId?: string;
      planId?: string;
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              plan,
              steps,
              stepCount: steps.length,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleProgress(
    args: Record<string, unknown>
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
    const progress = await computePlanProgress(plan, steps, this.resolverFactory);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              plan,
              progress,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
