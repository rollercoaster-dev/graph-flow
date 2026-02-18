import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { PlanningManager } from "@graph-flow/planning/manager";
import { AutomationOrchestrator, type GitHubClient } from "../orchestrator";

const TEST_PLANNING_DIR = "/tmp/graph-flow-test-automation-planning";

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

  beforeEach(async () => {
    planning = new PlanningManager(TEST_PLANNING_DIR);
    await planning.init();
  });

  afterEach(async () => {
    await rm(TEST_PLANNING_DIR, { recursive: true, force: true });
  });

  describe("importSource (milestone)", () => {
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

      const orchestrator = new AutomationOrchestrator(planning, gh);
      const result = await orchestrator.importSource("milestone", 1);

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
      const orchestrator = new AutomationOrchestrator(planning, gh);

      await expect(orchestrator.importSource("milestone", 999)).rejects.toThrow(
        "Milestone 999 not found",
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

      const orchestrator = new AutomationOrchestrator(planning, gh);
      const result = await orchestrator.importSource("milestone", 2);

      expect(result.stepIds).toHaveLength(0);
      expect(result.issueCount).toBe(0);
    });
  });

  describe("importSource (epic)", () => {
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

      const orchestrator = new AutomationOrchestrator(planning, gh);
      const result = await orchestrator.importSource("epic", 5);

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
      const orchestrator = new AutomationOrchestrator(planning, gh);

      await expect(orchestrator.importSource("epic", 999)).rejects.toThrow(
        "Epic issue #999 not found",
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

      const orchestrator = new AutomationOrchestrator(planning, gh);

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

      const orchestrator = new AutomationOrchestrator(planning, gh);
      const result = await orchestrator.createIssue({
        title: "Standalone issue",
      });

      expect(result.number).toBe(43);
      expect(result.stepId).toBeUndefined();
    });

    test("throws when gh create fails", async () => {
      const gh = mockGitHub({ createIssue: () => null });
      const orchestrator = new AutomationOrchestrator(planning, gh);

      await expect(
        orchestrator.createIssue({ title: "Failing issue" }),
      ).rejects.toThrow("Failed to create GitHub issue");
    });
  });
});
