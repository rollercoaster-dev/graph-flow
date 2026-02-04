import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { PlanningManager } from "@graph-flow/planning/manager";
import { WorkflowManager } from "@graph-flow/checkpoint/workflow";
import { AutomationOrchestrator, type GitHubClient } from "../orchestrator";

const TEST_PLANNING_DIR = "/tmp/graph-flow-test-automation-planning";
const TEST_WORKFLOWS_DIR = "/tmp/graph-flow-test-automation-workflows";

/** Create a mock GitHub client with sensible defaults. */
function mockGitHub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    fetchMilestone: () => null,
    fetchMilestoneIssues: () => [],
    fetchEpicSubIssues: () => [],
    fetchIssue: () => null,
    createIssue: () => null,
    createBranch: () => true,
    ...overrides,
  };
}

describe("AutomationOrchestrator", () => {
  let planning: PlanningManager;
  let workflows: WorkflowManager;

  beforeEach(async () => {
    planning = new PlanningManager(TEST_PLANNING_DIR);
    workflows = new WorkflowManager(TEST_WORKFLOWS_DIR);
    await planning.init();
    await workflows.init();
  });

  afterEach(async () => {
    await rm(TEST_PLANNING_DIR, { recursive: true, force: true });
    await rm(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
  });

  describe("fromMilestone", () => {
    test("creates goal, plan, and steps from milestone", async () => {
      const gh = mockGitHub({
        fetchMilestone: () => ({
          number: 1,
          title: "v1.0",
          description: "First release",
          state: "open",
          openIssues: 2,
          closedIssues: 0,
          url: "https://github.com/test/repo/milestone/1",
        }),
        fetchMilestoneIssues: () => [
          {
            number: 10,
            title: "Add auth",
            body: "",
            state: "OPEN",
            labels: [],
            url: "https://github.com/test/repo/issues/10",
          },
          {
            number: 11,
            title: "Add logging",
            body: "",
            state: "OPEN",
            labels: [],
            url: "https://github.com/test/repo/issues/11",
          },
        ],
      });

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);
      const result = await orchestrator.fromMilestone(1);

      expect(result.goalId).toStartWith("goal-");
      expect(result.planId).toStartWith("plan-");
      expect(result.stepIds).toHaveLength(2);
      expect(result.issueCount).toBe(2);
      expect(result.summary).toContain("v1.0");

      // Verify planning state
      const stack = planning.peekStack();
      expect(stack.depth).toBe(1);
      expect(stack.topItem?.title).toBe("v1.0");

      const plan = planning.getPlan(result.planId);
      expect(plan).not.toBeNull();
      expect(plan!.sourceType).toBe("milestone");

      const steps = planning.getStepsByPlan(result.planId);
      expect(steps).toHaveLength(2);
      expect(steps[0].externalRef.type).toBe("issue");
      expect(steps[0].externalRef.number).toBe(10);
    });

    test("throws when milestone not found", async () => {
      const gh = mockGitHub({ fetchMilestone: () => null });
      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);

      await expect(orchestrator.fromMilestone(999)).rejects.toThrow(
        "Milestone 999 not found"
      );
    });

    test("handles milestone with no issues", async () => {
      const gh = mockGitHub({
        fetchMilestone: () => ({
          number: 2,
          title: "Empty milestone",
          description: "",
          state: "open",
          openIssues: 0,
          closedIssues: 0,
          url: "",
        }),
        fetchMilestoneIssues: () => [],
      });

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);
      const result = await orchestrator.fromMilestone(2);

      expect(result.stepIds).toHaveLength(0);
      expect(result.issueCount).toBe(0);
    });
  });

  describe("fromEpic", () => {
    test("creates goal, plan, and steps from epic", async () => {
      const gh = mockGitHub({
        fetchIssue: () => ({
          number: 5,
          title: "Epic: Auth system",
          body: "Build complete auth",
          state: "OPEN",
          labels: ["epic"],
          url: "https://github.com/test/repo/issues/5",
        }),
        fetchEpicSubIssues: () => [
          { number: 6, title: "Login page", state: "OPEN" },
          { number: 7, title: "Logout flow", state: "OPEN" },
        ],
      });

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);
      const result = await orchestrator.fromEpic(5);

      expect(result.goalId).toStartWith("goal-");
      expect(result.planId).toStartWith("plan-");
      expect(result.stepIds).toHaveLength(2);
      expect(result.issueCount).toBe(2);
      expect(result.summary).toContain("Epic: Auth system");

      const plan = planning.getPlan(result.planId);
      expect(plan!.sourceType).toBe("epic");
    });

    test("throws when epic not found", async () => {
      const gh = mockGitHub({ fetchIssue: () => null });
      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);

      await expect(orchestrator.fromEpic(999)).rejects.toThrow(
        "Epic issue #999 not found"
      );
    });
  });

  describe("createIssue", () => {
    test("creates issue and links to plan", async () => {
      const gh = mockGitHub({
        createIssue: () => ({
          number: 42,
          url: "https://github.com/test/repo/issues/42",
        }),
      });

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);

      // Set up a plan to link to
      const { goal } = await planning.pushGoal({ title: "Test goal" });
      const plan = await planning.createPlan({
        title: "Test plan",
        goalId: goal.id,
        sourceType: "manual",
      });

      const result = await orchestrator.createIssue({
        title: "New feature",
        body: "Description here",
        labels: ["enhancement"],
        planId: plan.id,
      });

      expect(result.number).toBe(42);
      expect(result.url).toContain("/issues/42");
      expect(result.stepId).toStartWith("step-");

      // Verify step was created
      const steps = planning.getStepsByPlan(plan.id);
      expect(steps).toHaveLength(1);
      expect(steps[0].externalRef.number).toBe(42);
    });

    test("creates issue without plan link", async () => {
      const gh = mockGitHub({
        createIssue: () => ({
          number: 43,
          url: "https://github.com/test/repo/issues/43",
        }),
      });

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);
      const result = await orchestrator.createIssue({
        title: "Standalone issue",
      });

      expect(result.number).toBe(43);
      expect(result.stepId).toBeUndefined();
    });

    test("throws when gh create fails", async () => {
      const gh = mockGitHub({ createIssue: () => null });
      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);

      await expect(
        orchestrator.createIssue({ title: "Failing issue" })
      ).rejects.toThrow("Failed to create GitHub issue");
    });
  });

  describe("startIssue", () => {
    test("creates branch, goal, and checkpoint", async () => {
      const gh = mockGitHub({
        fetchIssue: () => ({
          number: 15,
          title: "Fix login bug",
          body: "Users cannot login",
          state: "OPEN",
          labels: ["bug"],
          url: "https://github.com/test/repo/issues/15",
        }),
        createBranch: () => true,
      });

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);
      const result = await orchestrator.startIssue(15);

      expect(result.branch).toBe("issue-15-fix-login-bug");
      expect(result.goalId).toStartWith("goal-");
      expect(result.checkpointId).toBe("workflow-15");
      expect(result.issue.number).toBe(15);
      expect(result.planStepId).toBeUndefined();

      // Verify planning stack
      const stack = planning.peekStack();
      expect(stack.topItem?.title).toBe("Fix login bug");

      // Verify checkpoint
      const workflow = await workflows.get("workflow-15");
      expect(workflow).not.toBeNull();
      expect(workflow!.branch).toBe("issue-15-fix-login-bug");
      expect(workflow!.status).toBe("running");
    });

    test("links to existing plan step when tracked", async () => {
      const gh = mockGitHub({
        fetchIssue: () => ({
          number: 20,
          title: "Add feature X",
          body: "",
          state: "OPEN",
          labels: [],
          url: "https://github.com/test/repo/issues/20",
        }),
        createBranch: () => true,
      });

      // Set up a plan with this issue tracked
      const { goal } = await planning.pushGoal({ title: "Parent goal" });
      const plan = await planning.createPlan({
        title: "Parent plan",
        goalId: goal.id,
        sourceType: "milestone",
      });
      const steps = await planning.createSteps(plan.id, [
        {
          title: "Add feature X",
          ordinal: 1,
          wave: 1,
          externalRef: { type: "issue", number: 20 },
        },
      ]);

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);
      const result = await orchestrator.startIssue(20);

      expect(result.planStepId).toBe(steps[0].id);
    });

    test("throws when issue not found", async () => {
      const gh = mockGitHub({ fetchIssue: () => null });
      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);

      await expect(orchestrator.startIssue(999)).rejects.toThrow(
        "Issue #999 not found"
      );
    });

    test("throws when branch creation fails", async () => {
      const gh = mockGitHub({
        fetchIssue: () => ({
          number: 30,
          title: "Some issue",
          body: "",
          state: "OPEN",
          labels: [],
          url: "",
        }),
        createBranch: () => false,
      });

      const orchestrator = new AutomationOrchestrator(planning, workflows, gh);

      await expect(orchestrator.startIssue(30)).rejects.toThrow(
        "Failed to create branch"
      );
    });
  });
});
