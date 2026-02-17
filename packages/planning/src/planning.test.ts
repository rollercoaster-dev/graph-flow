import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { PlanningManager } from "./manager";
import { PlanningMCPTools } from "./mcp-tools";

const TEST_DIR = join(import.meta.dir, "../.test-planning");

describe("PlanningManager", () => {
  let manager: PlanningManager;

  beforeEach(async () => {
    manager = new PlanningManager(TEST_DIR);
    await manager.init();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("pushGoal creates a goal at top of stack", async () => {
    const { goal, stack } = await manager.pushGoal({
      title: "Test goal",
      description: "A test goal",
    });

    expect(goal.id).toStartWith("goal-");
    expect(goal.title).toBe("Test goal");
    expect(goal.description).toBe("A test goal");
    expect(goal.status).toBe("active");
    expect(goal.stackOrder).toBe(0);
    expect(stack.depth).toBe(1);
    expect(stack.topItem?.id).toBe(goal.id);
  });

  test("pushGoal pauses previous active item", async () => {
    const { goal: goal1 } = await manager.pushGoal({ title: "Goal 1" });
    const { goal: goal2, stack } = await manager.pushGoal({ title: "Goal 2" });

    expect(goal2.status).toBe("active");
    expect(goal2.stackOrder).toBe(0);
    expect(stack.depth).toBe(2);

    // Check goal1 is now paused
    const goal1Updated = manager.getEntity(goal1.id);
    expect(goal1Updated?.status).toBe("paused");
    expect(goal1Updated?.stackOrder).toBe(1);
  });

  test("pushInterrupt creates interrupt and links to interrupted item", async () => {
    const { goal } = await manager.pushGoal({ title: "Original goal" });
    const { interrupt, interruptedItem, stack } = await manager.pushInterrupt({
      title: "Urgent fix",
      reason: "Production issue",
    });

    expect(interrupt.id).toStartWith("interrupt-");
    expect(interrupt.title).toBe("Urgent fix");
    expect(interrupt.reason).toBe("Production issue");
    expect(interrupt.interruptedId).toBe(goal.id);
    expect(interruptedItem?.id).toBe(goal.id);
    expect(stack.depth).toBe(2);
    expect(stack.topItem?.id).toBe(interrupt.id);
  });

  test("popStack completes top item and resumes next", async () => {
    await manager.pushGoal({ title: "Goal 1" });
    const { goal: goal2 } = await manager.pushGoal({ title: "Goal 2" });

    const { completed, resumed, stack } = await manager.popStack();

    expect(completed?.id).toBe(goal2.id);
    expect(completed?.status).toBe("completed");
    expect(resumed?.title).toBe("Goal 1");
    expect(resumed?.status).toBe("active");
    expect(stack.depth).toBe(1);
  });

  test("popStack on empty stack returns null", async () => {
    const { completed, resumed, stack } = await manager.popStack();

    expect(completed).toBeNull();
    expect(resumed).toBeNull();
    expect(stack.depth).toBe(0);
  });

  test("createPlan and getPlanByGoal work correctly", async () => {
    const { goal } = await manager.pushGoal({ title: "Feature goal" });
    const plan = await manager.createPlan({
      title: "Feature plan",
      goalId: goal.id,
      sourceType: "manual",
    });

    expect(plan.id).toStartWith("plan-");
    expect(plan.title).toBe("Feature plan");
    expect(plan.goalId).toBe(goal.id);

    const retrieved = manager.getPlanByGoal(goal.id);
    expect(retrieved?.id).toBe(plan.id);
  });

  test("createSteps and getStepsByPlan work correctly", async () => {
    const { goal } = await manager.pushGoal({ title: "Feature goal" });
    const plan = await manager.createPlan({
      title: "Feature plan",
      goalId: goal.id,
      sourceType: "manual",
    });

    const steps = await manager.createSteps(plan.id, [
      {
        title: "Step 1",
        ordinal: 1,
        wave: 1,
        externalRef: { type: "manual", criteria: "Do thing 1" },
      },
      {
        title: "Step 2",
        ordinal: 2,
        wave: 1,
        externalRef: { type: "manual", criteria: "Do thing 2" },
        dependsOn: [],
      },
    ]);

    expect(steps.length).toBe(2);
    expect(steps[0].title).toBe("Step 1");
    expect(steps[1].title).toBe("Step 2");

    const retrieved = manager.getStepsByPlan(plan.id);
    expect(retrieved.length).toBe(2);
    expect(retrieved[0].ordinal).toBe(1);
    expect(retrieved[1].ordinal).toBe(2);
  });

  describe("syncFromGitHub", () => {
    test("detects status change from persisted state", async () => {
      // Setup: goal + plan + issue-linked step
      const { goal } = await manager.pushGoal({ title: "Sync test" });
      const plan = await manager.createPlan({
        title: "Sync plan",
        goalId: goal.id,
        sourceType: "manual",
      });
      const steps = await manager.createSteps(plan.id, [
        {
          title: "Issue step",
          ordinal: 1,
          wave: 1,
          externalRef: { type: "issue", number: 999 },
        },
      ]);

      // Seed the persisted resolved status as "not-started"
      const storage = manager.getStorage();
      storage.setResolvedStatus(steps[0].id, "not-started");
      await storage.persistResolvedStatuses();

      // IssueResolver checks manual overrides before hitting GitHub (see resolvers.ts).
      // setStepStatus acts as a test double for a GitHub-resolved "done" state,
      // letting us validate the persisted-vs-resolved comparison in syncFromGitHub
      // without requiring a live GitHub CLI.
      await manager.setStepStatus(steps[0].id, "done");

      const results = await manager.syncFromGitHub(plan.id);

      // Should detect the change: stored "not-started" vs resolved "done"
      expect(results.attempted).toBe(1);
      expect(results.updated.length).toBe(1);
      expect(results.updated[0].oldStatus).toBe("not-started");
      expect(results.updated[0].newStatus).toBe("done");
    });

    test("reports unchanged when status matches persisted state", async () => {
      const { goal } = await manager.pushGoal({ title: "Unchanged test" });
      const plan = await manager.createPlan({
        title: "Plan",
        goalId: goal.id,
        sourceType: "manual",
      });
      const steps = await manager.createSteps(plan.id, [
        {
          title: "Issue step",
          ordinal: 1,
          wave: 1,
          externalRef: { type: "issue", number: 888 },
        },
      ]);

      // Set a manual override to "done" and also seed persisted as "done"
      await manager.setStepStatus(steps[0].id, "done");
      const storage = manager.getStorage();
      storage.setResolvedStatus(steps[0].id, "done");
      await storage.persistResolvedStatuses();

      const results = await manager.syncFromGitHub(plan.id);

      expect(results.attempted).toBe(1);
      expect(results.updated.length).toBe(0);
      expect(results.unchanged).toBe(1);
    });

    test("first sync records error when GitHub CLI fails", async () => {
      const { goal } = await manager.pushGoal({ title: "First sync" });
      const plan = await manager.createPlan({
        title: "Plan",
        goalId: goal.id,
        sourceType: "manual",
      });
      await manager.createSteps(plan.id, [
        {
          title: "Issue step",
          ordinal: 1,
          wave: 1,
          externalRef: { type: "issue", number: 777 },
        },
      ]);

      // No persisted status, no manual override
      // Resolver will hit GitHub (which will fail in test) → throws → recorded as error
      const results = await manager.syncFromGitHub(plan.id);

      expect(results.attempted).toBe(1);
      expect(results.errors.length).toBe(1);
      expect(results.errors[0].issue).toBe(777);
      expect(results.unchanged).toBe(0);
    });

    test("error on one step does not abort sync of remaining steps", async () => {
      const { goal } = await manager.pushGoal({ title: "Mixed sync" });
      const plan = await manager.createPlan({
        title: "Plan",
        goalId: goal.id,
        sourceType: "manual",
      });
      const steps = await manager.createSteps(plan.id, [
        {
          title: "Step with override",
          ordinal: 1,
          wave: 1,
          externalRef: { type: "issue", number: 111 },
        },
        {
          title: "Step without override",
          ordinal: 2,
          wave: 1,
          externalRef: { type: "issue", number: 222 },
        },
      ]);

      // Set manual override on step 1 (will succeed) and seed persisted as not-started
      await manager.setStepStatus(steps[0].id, "done");
      const storage = manager.getStorage();
      storage.setResolvedStatus(steps[0].id, "not-started");
      await storage.persistResolvedStatuses();

      // Step 2 has no override → GitHub CLI fails → error
      const results = await manager.syncFromGitHub(plan.id);

      // Step 1: resolved "done" vs persisted "not-started" → updated
      expect(results.updated.length).toBe(1);
      expect(results.updated[0].oldStatus).toBe("not-started");
      expect(results.updated[0].newStatus).toBe("done");

      // Step 2: GitHub CLI failed → error (not abort)
      expect(results.errors.length).toBe(1);
      expect(results.errors[0].issue).toBe(222);

      expect(results.attempted).toBe(2);
    });

    test("resolved statuses survive across manager instances (round-trip)", async () => {
      const { goal } = await manager.pushGoal({ title: "Round-trip test" });
      const plan = await manager.createPlan({
        title: "Plan",
        goalId: goal.id,
        sourceType: "manual",
      });
      const steps = await manager.createSteps(plan.id, [
        {
          title: "Issue step",
          ordinal: 1,
          wave: 1,
          externalRef: { type: "issue", number: 555 },
        },
      ]);

      // Seed persisted as "not-started", set manual override to "done"
      const storage = manager.getStorage();
      storage.setResolvedStatus(steps[0].id, "not-started");
      await storage.persistResolvedStatuses();
      await manager.setStepStatus(steps[0].id, "done");

      // Sync writes the new resolved status ("done") to disk
      const results = await manager.syncFromGitHub(plan.id);
      expect(results.updated.length).toBe(1);

      // Create a fresh manager from the same directory — simulates process restart
      const manager2 = new PlanningManager(TEST_DIR);
      await manager2.init();

      // The persisted resolved status should survive the round-trip
      const freshStorage = manager2.getStorage();
      expect(freshStorage.getResolvedStatus(steps[0].id)).toBe("done");
    });
  });
});

describe("PlanningMCPTools", () => {
  let tools: PlanningMCPTools;

  beforeEach(async () => {
    tools = new PlanningMCPTools(TEST_DIR);
    await tools.init();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("getTools returns all 8 planning tools", () => {
    const toolList = tools.getTools();
    expect(toolList.length).toBe(8);

    const names = toolList.map((t) => t.name);
    expect(names).toContain("p-goal");
    expect(names).toContain("p-interrupt");
    expect(names).toContain("p-done");
    expect(names).toContain("p-stack");
    expect(names).toContain("p-plan");
    expect(names).toContain("p-steps");
    expect(names).toContain("p-progress");
    expect(names).toContain("p-sync");
  });

  test("p-goal creates goal via MCP", async () => {
    const result = await tools.handleToolCall("p-goal", {
      title: "MCP Goal",
      description: "Created via MCP",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.goal.title).toBe("MCP Goal");
    expect(data.goal.description).toBe("Created via MCP");
    expect(data.stack.depth).toBe(1);
  });

  test("p-stack returns current stack", async () => {
    await tools.handleToolCall("p-goal", { title: "Goal 1" });
    await tools.handleToolCall("p-goal", { title: "Goal 2" });

    const result = await tools.handleToolCall("p-stack", {
      includeStale: false,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.stack.depth).toBe(2);
    expect(data.stack.topItem.title).toBe("Goal 2");
    expect(data.stack.items.length).toBe(2);
  });

  test("p-done pops and returns completed item", async () => {
    await tools.handleToolCall("p-goal", { title: "Goal to complete" });

    const result = await tools.handleToolCall("p-done", {
      summary: "Finished the task",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.completed.item.title).toBe("Goal to complete");
    expect(data.completed.summary).toBe("Finished the task");
    expect(data.stack.depth).toBe(0);
  });

  test("full workflow: goal -> plan -> steps -> progress", async () => {
    // Create goal
    const goalResult = await tools.handleToolCall("p-goal", {
      title: "Feature X",
    });
    const goalData = JSON.parse(goalResult.content[0].text);
    const goalId = goalData.goal.id;

    // Create plan
    const planResult = await tools.handleToolCall("p-plan", {
      title: "Feature X Plan",
      goalId,
      sourceType: "manual",
    });
    const planData = JSON.parse(planResult.content[0].text);
    const planId = planData.plan.id;

    // Add steps
    await tools.handleToolCall("p-steps", {
      planId,
      steps: [
        {
          title: "Step A",
          ordinal: 1,
          wave: 1,
          externalRef: { type: "manual", criteria: "Do A" },
        },
        {
          title: "Step B",
          ordinal: 2,
          wave: 2,
          externalRef: { type: "manual", criteria: "Do B" },
        },
      ],
    });

    // Get plan + steps + progress (merged into p-progress)
    const progressResult = await tools.handleToolCall("p-progress", {
      goalId,
    });
    const progressData = JSON.parse(progressResult.content[0].text);
    expect(progressData.stepCount).toBe(2);
    expect(progressData.steps).toHaveLength(2);
    expect(progressData.progress.total).toBe(2);
    expect(progressData.progress.notStarted).toBe(2);
    expect(progressData.progress.percentage).toBe(0);
  });
});

