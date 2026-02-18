import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  type WorkflowAction,
  type WorkflowCommit,
  WorkflowManager,
} from "../src/workflow.ts";

const TEST_DIR = "/tmp/graph-flow-test-workflows";

describe("WorkflowManager", () => {
  let manager: WorkflowManager;

  beforeEach(async () => {
    manager = new WorkflowManager(TEST_DIR, 10);
    await manager.init();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("should create workflow", async () => {
    const workflow = await manager.create({
      id: "test-123",
      issueNumber: 123,
      title: "Test workflow",
      phase: "research",
    });

    expect(workflow.id).toBe("test-123");
    expect(workflow.issueNumber).toBe(123);
    expect(workflow.title).toBe("Test workflow");
    expect(workflow.phase).toBe("research");
  });

  test("should retrieve workflow from cache", async () => {
    await manager.create({
      id: "test-123",
      title: "Test workflow",
    });

    const workflow = await manager.get("test-123");
    expect(workflow?.id).toBe("test-123");
  });

  test("should update workflow", async () => {
    await manager.create({
      id: "test-123",
      title: "Test workflow",
    });

    const updated = await manager.update("test-123", {
      phase: "implement",
      context: ["Added feature X"],
      decisions: ["Using approach Y"],
    });

    expect(updated.phase).toBe("implement");
    expect(updated.context).toContain("Added feature X");
    expect(updated.decisions).toContain("Using approach Y");
  });

  test("should find workflow by issue number", async () => {
    await manager.create({
      id: "test-123",
      issueNumber: 123,
      title: "Test workflow",
    });

    const workflow = await manager.findByIssue(123);
    expect(workflow?.id).toBe("test-123");
  });

  test("should list active workflows", async () => {
    await manager.create({
      id: "test-1",
      title: "Workflow 1",
    });
    await manager.create({
      id: "test-2",
      title: "Workflow 2",
    });

    const workflows = await manager.list();
    expect(workflows).toHaveLength(2);
  });

  test("should complete and delete workflow", async () => {
    await manager.create({
      id: "test-123",
      title: "Test workflow",
    });

    await manager.complete("test-123", true);

    // Wait for deletion
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const workflow = await manager.get("test-123");
    expect(workflow).toBeNull();
  });

  test("should reconstruct state from events", async () => {
    await manager.create({
      id: "test-123",
      title: "Test workflow",
    });

    await manager.update("test-123", { phase: "implement" });
    await manager.update("test-123", { context: ["Context 1"] });
    await manager.update("test-123", { decisions: ["Decision 1"] });

    // Clear cache to force reconstruction
    manager.cache.clear();

    const workflow = await manager.get("test-123");
    expect(workflow?.phase).toBe("implement");
    expect(workflow?.context).toContain("Context 1");
    expect(workflow?.decisions).toContain("Decision 1");
  });

  test("should create workflow with branch, worktree, status, and taskId", async () => {
    const workflow = await manager.create({
      id: "feature-42",
      issueNumber: 42,
      title: "Feature workflow",
      branch: "feature/42-auth",
      worktree: "/tmp/worktrees/42",
      status: "paused",
      taskId: "task-99",
    });

    expect(workflow.branch).toBe("feature/42-auth");
    expect(workflow.worktree).toBe("/tmp/worktrees/42");
    expect(workflow.status).toBe("paused");
    expect(workflow.taskId).toBe("task-99");
    expect(workflow.retryCount).toBe(0);
    expect(workflow.actions).toEqual([]);
    expect(workflow.commits).toEqual([]);
  });

  test("should apply defaults for new fields when not provided (backward compat)", async () => {
    const workflow = await manager.create({
      id: "old-style",
      title: "Old style workflow",
    });

    expect(workflow.status).toBe("running");
    expect(workflow.retryCount).toBe(0);
    expect(workflow.actions).toEqual([]);
    expect(workflow.commits).toEqual([]);
    expect(workflow.branch).toBeUndefined();
    expect(workflow.worktree).toBeUndefined();
    expect(workflow.taskId).toBeUndefined();
  });

  test("should log action via update", async () => {
    await manager.create({
      id: "test-actions",
      title: "Action test",
    });

    const action: WorkflowAction = {
      action: "run tests",
      result: "success",
      metadata: { suite: "unit" },
      timestamp: new Date().toISOString(),
    };

    const updated = await manager.update("test-actions", {
      logAction: action,
    });

    expect(updated.actions).toHaveLength(1);
    expect(updated.actions[0].action).toBe("run tests");
    expect(updated.actions[0].result).toBe("success");
    expect(updated.actions[0].metadata).toEqual({ suite: "unit" });
  });

  test("should log commit via update", async () => {
    await manager.create({
      id: "test-commits",
      title: "Commit test",
    });

    const commit: WorkflowCommit = {
      sha: "abc1234",
      message: "feat: add auth",
      timestamp: new Date().toISOString(),
    };

    const updated = await manager.update("test-commits", {
      logCommit: commit,
    });

    expect(updated.commits).toHaveLength(1);
    expect(updated.commits[0].sha).toBe("abc1234");
    expect(updated.commits[0].message).toBe("feat: add auth");
  });

  test("should increment retryCount on status change to failed", async () => {
    await manager.create({
      id: "test-retry",
      title: "Retry test",
    });

    expect((await manager.get("test-retry"))?.retryCount).toBe(0);

    await manager.update("test-retry", { status: "failed" });
    expect((await manager.get("test-retry"))?.retryCount).toBe(1);

    await manager.update("test-retry", { status: "failed" });
    expect((await manager.get("test-retry"))?.retryCount).toBe(2);

    // Non-failure status change should not increment
    await manager.update("test-retry", { status: "running" });
    expect((await manager.get("test-retry"))?.retryCount).toBe(2);
  });

  test("should recover workflow with correct plan", async () => {
    await manager.create({
      id: "test-recover",
      issueNumber: 77,
      title: "Recovery test",
      branch: "fix/77-bug",
    });

    await manager.update("test-recover", { phase: "implement" });

    const pendingAction: WorkflowAction = {
      action: "apply patch",
      result: "pending",
      timestamp: new Date().toISOString(),
    };
    await manager.update("test-recover", { logAction: pendingAction });

    const commit: WorkflowCommit = {
      sha: "def5678",
      message: "wip: partial fix",
      timestamp: new Date().toISOString(),
    };
    await manager.update("test-recover", { logCommit: commit });

    const plan = await manager.recover("test-recover");

    expect(plan).not.toBeNull();
    expect(plan?.resumePhase).toBe("implement");
    expect(plan?.pendingActions).toHaveLength(1);
    expect(plan?.pendingActions[0].action).toBe("apply patch");
    expect(plan?.lastCommit?.sha).toBe("def5678");
    expect(plan?.summary).toContain("Recovery test");
    expect(plan?.summary).toContain("Branch: fix/77-bug");
    expect(plan?.summary).toContain("1 pending action(s)");
  });

  test("should reconstruct new event types from disk", async () => {
    await manager.create({
      id: "test-reconstruct",
      title: "Reconstruct test",
      branch: "main",
    });

    const action: WorkflowAction = {
      action: "build",
      result: "success",
      timestamp: new Date().toISOString(),
    };
    await manager.update("test-reconstruct", { logAction: action });

    const commit: WorkflowCommit = {
      sha: "aaa1111",
      message: "chore: build",
      timestamp: new Date().toISOString(),
    };
    await manager.update("test-reconstruct", { logCommit: commit });
    await manager.update("test-reconstruct", { status: "failed" });

    // Clear cache to force reconstruction from events
    manager.cache.clear();

    const workflow = await manager.get("test-reconstruct");
    expect(workflow?.actions).toHaveLength(1);
    expect(workflow?.actions[0].action).toBe("build");
    expect(workflow?.commits).toHaveLength(1);
    expect(workflow?.commits[0].sha).toBe("aaa1111");
    expect(workflow?.status).toBe("failed");
    expect(workflow?.retryCount).toBe(1);
  });

  test("should support milestone phases", async () => {
    const workflow = await manager.create({
      id: "milestone-1",
      title: "Q1 Milestone",
      phase: "planning",
    });

    expect(workflow.phase).toBe("planning");

    const updated = await manager.update("milestone-1", { phase: "execute" });
    expect(updated.phase).toBe("execute");

    const merged = await manager.update("milestone-1", { phase: "merge" });
    expect(merged.phase).toBe("merge");

    const cleaned = await manager.update("milestone-1", { phase: "cleanup" });
    expect(cleaned.phase).toBe("cleanup");
  });

  test("should exclude completed-status workflows from list", async () => {
    await manager.create({
      id: "active-1",
      title: "Active workflow",
    });
    await manager.create({
      id: "done-1",
      title: "Done workflow",
    });

    await manager.update("done-1", { status: "completed" });

    const workflows = await manager.list();
    expect(workflows).toHaveLength(1);
    expect(workflows[0].id).toBe("active-1");
  });
});
