/**
 * Automation Orchestrator
 *
 * Coordinates GitHub operations with planning stack and checkpoints.
 * Accepts shared PlanningManager + WorkflowManager instances to
 * maintain in-memory cache coherence with MCP tools.
 */

import type { PlanningManager } from "@graph-flow/planning/manager";
import type { WorkflowManager } from "@graph-flow/checkpoint/workflow";
import * as ghDefault from "./github";
import type {
  GitHubMilestone,
  GitHubIssue,
  GitHubSubIssue,
  AutomationResult,
  IssueCreationResult,
  WorkStartResult,
} from "./types";

/** Injectable GitHub client interface for testability. */
export interface GitHubClient {
  fetchMilestone(num: number, repo?: string): GitHubMilestone | null;
  fetchMilestoneIssues(milestoneNum: number, repo?: string): GitHubIssue[];
  fetchEpicSubIssues(epicNum: number, repo?: string): GitHubSubIssue[];
  fetchIssue(num: number, repo?: string): GitHubIssue | null;
  createIssue(opts: {
    title: string;
    body?: string;
    labels?: string[];
    milestone?: number;
    repo?: string;
  }): { number: number; url: string } | null;
  createBranch(name: string): boolean;
}

export class AutomationOrchestrator {
  private gh: GitHubClient;
  private githubRepo?: string;

  constructor(
    private planning: PlanningManager,
    private workflows: WorkflowManager,
    gh?: GitHubClient,
    githubRepo?: string,
  ) {
    this.gh = gh ?? ghDefault;
    this.githubRepo = githubRepo;
  }

  /**
   * Import a GitHub milestone into the planning stack.
   * Creates a Goal, Plan (sourceType: "milestone"), and Steps (one per issue).
   */
  async fromMilestone(num: number): Promise<AutomationResult> {
    const milestone = this.gh.fetchMilestone(num, this.githubRepo);
    if (!milestone) {
      throw new Error(`Milestone ${num} not found`);
    }

    const issues = this.gh.fetchMilestoneIssues(num, this.githubRepo);

    // Push goal
    const { goal } = await this.planning.pushGoal({
      title: milestone.title,
      description: milestone.description || undefined,
    });

    // Create plan
    const plan = await this.planning.createPlan({
      title: milestone.title,
      goalId: goal.id,
      sourceType: "milestone",
      sourceRef: String(num),
    });

    // Create steps (one per issue, all wave 1)
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

  /**
   * Import a GitHub epic (issue with sub-issues) into the planning stack.
   * Creates a Goal, Plan (sourceType: "epic"), and Steps (one per sub-issue).
   */
  async fromEpic(num: number): Promise<AutomationResult> {
    const epic = this.gh.fetchIssue(num, this.githubRepo);
    if (!epic) {
      throw new Error(`Epic issue #${num} not found`);
    }

    const subIssues = this.gh.fetchEpicSubIssues(num, this.githubRepo);

    // Push goal
    const { goal } = await this.planning.pushGoal({
      title: epic.title,
      description: epic.body || undefined,
      issueNumber: num,
    });

    // Create plan
    const plan = await this.planning.createPlan({
      title: epic.title,
      goalId: goal.id,
      sourceType: "epic",
      sourceRef: String(num),
    });

    // Create steps (one per sub-issue, all wave 1)
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
      repo: this.githubRepo,
    });

    if (!result) {
      throw new Error("Failed to create GitHub issue");
    }

    let stepId: string | undefined;

    // Optionally link as a plan step
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
   * Start work on a GitHub issue.
   * Fetches the issue, creates a branch, pushes a Goal, and creates a checkpoint.
   */
  async startIssue(num: number): Promise<WorkStartResult> {
    const issue = this.gh.fetchIssue(num, this.githubRepo);
    if (!issue) {
      throw new Error(`Issue #${num} not found`);
    }

    // Create branch name from issue number and title
    const slug = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const branch = `issue-${num}-${slug}`;

    const branchCreated = this.gh.createBranch(branch);
    if (!branchCreated) {
      throw new Error(`Failed to create branch: ${branch}`);
    }

    // Check if this issue is already tracked as a plan step
    const tracked = this.planning.findStepByIssueNumber(num);

    // Push goal
    const { goal } = await this.planning.pushGoal({
      title: issue.title,
      description: issue.body || undefined,
      issueNumber: num,
      planStepId: tracked?.step.id,
    });

    // Create checkpoint
    const checkpointId = `workflow-${num}`;
    await this.workflows.create({
      id: checkpointId,
      issueNumber: num,
      title: issue.title,
      phase: "research",
      branch,
      status: "running",
    });

    return {
      branch,
      goalId: goal.id,
      checkpointId,
      issue,
      planStepId: tracked?.step.id,
    };
  }
}
