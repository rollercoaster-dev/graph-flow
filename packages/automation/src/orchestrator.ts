/**
 * Automation Orchestrator
 *
 * Coordinates GitHub operations with planning stack and checkpoints.
 * Accepts shared PlanningManager + WorkflowManager instances to
 * maintain in-memory cache coherence with MCP tools.
 *
 * Changes in v3:
 * - Merged fromMilestone/fromEpic into importSource(type, number)
 * - Removed startIssue (setup skill handles this directly via p-goal + c-update)
 * - Added boardUpdate for GitHub Project board operations
 */

import type { PlanningManager } from "@graph-flow/planning/manager";
import * as ghDefault from "./github";
import type {
  AutomationResult,
  BoardUpdateResult,
  GitHubIssue,
  GitHubMilestone,
  GitHubSubIssue,
  IssueCreationResult,
} from "./types";

/** Injectable GitHub client interface for testability. */
export interface GitHubClient {
  fetchMilestone(num: number): GitHubMilestone | null;
  fetchMilestoneIssues(milestoneNum: number): GitHubIssue[];
  fetchEpicSubIssues(epicNum: number): GitHubSubIssue[];
  fetchIssue(num: number): GitHubIssue | null;
  createIssue(opts: {
    title: string;
    body?: string;
    labels?: string[];
    milestone?: number;
  }): { number: number; url: string } | null;
  createBranch(name: string): boolean;
}

/** Board status values matching the GitHub Project board. */
type BoardStatus = "Backlog" | "Next" | "In Progress" | "Blocked" | "Done";

/** Board configuration from env vars with fallback defaults. */
interface BoardConfig {
  projectId: string;
  fieldId: string;
  orgLogin: string;
  projectNumber: number;
  statusOptions: Record<BoardStatus, string>;
}

function getBoardConfig(): BoardConfig {
  return {
    projectId: process.env.BOARD_PROJECT_ID ?? "PVT_kwDOB1lz3c4BI2yZ",
    fieldId: process.env.BOARD_FIELD_ID ?? "PVTSSF_lADOB1lz3c4BI2yZzg5MUx4",
    orgLogin: process.env.BOARD_ORG_LOGIN ?? "rollercoaster-dev",
    projectNumber: Number(process.env.BOARD_PROJECT_NUMBER ?? "11"),
    statusOptions: {
      Backlog: process.env.BOARD_OPT_BACKLOG ?? "47fc9ee4",
      Next: process.env.BOARD_OPT_NEXT ?? "d818c31f",
      "In Progress": process.env.BOARD_OPT_IN_PROGRESS ?? "3e320f16",
      Blocked: process.env.BOARD_OPT_BLOCKED ?? "51c2af7b",
      Done: process.env.BOARD_OPT_DONE ?? "98236657",
    },
  };
}

export class AutomationOrchestrator {
  private gh: GitHubClient;

  constructor(
    private planning: PlanningManager,
    gh?: GitHubClient,
  ) {
    this.gh = gh ?? ghDefault;
  }

  /**
   * Import a GitHub milestone or epic into the planning stack.
   * Creates a Goal, Plan, and Steps (one per issue/sub-issue).
   */
  async importSource(
    type: "milestone" | "epic",
    number: number,
  ): Promise<AutomationResult> {
    if (type === "milestone") {
      return this.importMilestone(number);
    }
    return this.importEpic(number);
  }

  private async importMilestone(num: number): Promise<AutomationResult> {
    const milestone = this.gh.fetchMilestone(num);
    if (!milestone) {
      throw new Error(`Milestone ${num} not found`);
    }

    const issues = this.gh.fetchMilestoneIssues(num);

    const { goal } = await this.planning.pushGoal({
      title: milestone.title,
      description: milestone.description || undefined,
    });

    const plan = await this.planning.createPlan({
      title: milestone.title,
      goalId: goal.id,
      sourceType: "milestone",
      sourceRef: String(num),
    });

    const stepInputs = issues.map((issue, idx) => ({
      title: issue.title,
      ordinal: idx + 1,
      wave: 1,
      externalRef: {
        type: "issue" as const,
        number: issue.number,
      },
    }));

    const steps =
      stepInputs.length > 0
        ? await this.planning.createSteps(plan.id, stepInputs)
        : [];

    return {
      goalId: goal.id,
      planId: plan.id,
      stepIds: steps.map((s) => s.id),
      issueCount: issues.length,
      summary: `Imported milestone "${milestone.title}" with ${issues.length} issue(s)`,
    };
  }

  private async importEpic(num: number): Promise<AutomationResult> {
    const epic = this.gh.fetchIssue(num);
    if (!epic) {
      throw new Error(`Epic issue #${num} not found`);
    }

    const subIssues = this.gh.fetchEpicSubIssues(num);

    const { goal } = await this.planning.pushGoal({
      title: epic.title,
      description: epic.body || undefined,
      issueNumber: num,
    });

    const plan = await this.planning.createPlan({
      title: epic.title,
      goalId: goal.id,
      sourceType: "epic",
      sourceRef: String(num),
    });

    const stepInputs = subIssues.map((sub, idx) => ({
      title: sub.title,
      ordinal: idx + 1,
      wave: 1,
      externalRef: {
        type: "issue" as const,
        number: sub.number,
      },
    }));

    const steps =
      stepInputs.length > 0
        ? await this.planning.createSteps(plan.id, stepInputs)
        : [];

    return {
      goalId: goal.id,
      planId: plan.id,
      stepIds: steps.map((s) => s.id),
      issueCount: subIssues.length,
      summary: `Imported epic "${epic.title}" with ${subIssues.length} sub-issue(s)`,
    };
  }

  /**
   * Create a GitHub issue and optionally link it as a PlanStep.
   */
  async createIssue(opts: {
    title: string;
    body?: string;
    labels?: string[];
    milestone?: number;
    planId?: string;
  }): Promise<IssueCreationResult> {
    const result = this.gh.createIssue({
      title: opts.title,
      body: opts.body,
      labels: opts.labels,
      milestone: opts.milestone,
    });

    if (!result) {
      throw new Error("Failed to create GitHub issue");
    }

    let stepId: string | undefined;

    if (opts.planId) {
      const plan = this.planning.getPlan(opts.planId);
      if (plan) {
        const existingSteps = this.planning.getStepsByPlan(plan.id);
        const nextOrdinal = existingSteps.length + 1;

        const steps = await this.planning.createSteps(plan.id, [
          {
            title: opts.title,
            ordinal: nextOrdinal,
            wave: 1,
            externalRef: {
              type: "issue",
              number: result.number,
            },
          },
        ]);
        stepId = steps[0]?.id;
      }
    }

    return {
      number: result.number,
      url: result.url,
      stepId,
    };
  }

  /**
   * Update a GitHub Project board item's status.
   * Uses GraphQL mutations via gh CLI.
   */
  async boardUpdate(
    issueNumber: number,
    status: BoardStatus,
  ): Promise<BoardUpdateResult> {
    const config = getBoardConfig();
    const optionId = config.statusOptions[status];

    if (!optionId) {
      return {
        issueNumber,
        itemId: "",
        status,
        success: false,
        error: `Unknown board status: ${status}`,
      };
    }

    try {
      // Get issue node ID
      const issueProc = Bun.spawn(
        [
          "gh",
          "issue",
          "view",
          String(issueNumber),
          "--json",
          "id",
          "-q",
          ".id",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      await issueProc.exited;
      if (issueProc.exitCode !== 0) {
        return {
          issueNumber,
          itemId: "",
          status,
          success: false,
          error: `Issue #${issueNumber} not found`,
        };
      }
      const contentId = (await new Response(issueProc.stdout).text()).trim();

      // Add to project (idempotent — returns existing item if already added)
      const addProc = Bun.spawn(
        [
          "gh",
          "api",
          "graphql",
          "-f",
          `query=mutation($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }`,
          "-f",
          `projectId=${config.projectId}`,
          "-f",
          `contentId=${contentId}`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      await addProc.exited;
      const addStdout = await new Response(addProc.stdout).text();
      const addStderr = await new Response(addProc.stderr).text();

      let itemId: string;
      if (addProc.exitCode === 0) {
        const addData = JSON.parse(addStdout);
        itemId = addData?.data?.addProjectV2ItemById?.item?.id;
      } else {
        // Inspect stderr: auth/network failures are terminal; "already exists" → fallback query
        if (/401|403|unauthorized|forbidden|credentials/i.test(addStderr)) {
          return {
            issueNumber,
            itemId: "",
            status,
            success: false,
            error: `Auth/network failure adding to board: ${addStderr.trim()}`,
          };
        }

        // Fallback: query for existing item
        const queryProc = Bun.spawn(
          [
            "gh",
            "api",
            "graphql",
            "-f",
            `query=query { organization(login: "${config.orgLogin}") { projectV2(number: ${config.projectNumber}) { items(first: 100) { nodes { id content { ... on Issue { number } } } } } } }`,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        await queryProc.exited;
        if (queryProc.exitCode !== 0) {
          return {
            issueNumber,
            itemId: "",
            status,
            success: false,
            error: "Failed to find project item",
          };
        }
        const queryStdout = await new Response(queryProc.stdout).text();
        const queryData = JSON.parse(queryStdout);
        const nodes =
          queryData?.data?.organization?.projectV2?.items?.nodes ?? [];
        const item = nodes.find(
          (n: { content?: { number?: number } }) =>
            n.content?.number === issueNumber,
        );
        if (!item) {
          return {
            issueNumber,
            itemId: "",
            status,
            success: false,
            error: `Issue #${issueNumber} not found on project board`,
          };
        }
        itemId = item.id;
      }

      // Update status field
      const updateProc = Bun.spawn(
        [
          "gh",
          "api",
          "graphql",
          "-f",
          `query=mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }`,
          "-f",
          `projectId=${config.projectId}`,
          "-f",
          `itemId=${itemId}`,
          "-f",
          `fieldId=${config.fieldId}`,
          "-f",
          `optionId=${optionId}`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      await updateProc.exited;

      if (updateProc.exitCode !== 0) {
        const updateStderr = await new Response(updateProc.stderr).text();
        return {
          issueNumber,
          itemId,
          status,
          success: false,
          error: `Failed to update status: ${updateStderr.trim()}`,
        };
      }

      return {
        issueNumber,
        itemId,
        status,
        success: true,
      };
    } catch (error) {
      return {
        issueNumber,
        itemId: "",
        status,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
