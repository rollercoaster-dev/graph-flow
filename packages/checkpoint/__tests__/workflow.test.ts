import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorkflowManager } from "../src/workflow.ts";
import { rm } from "node:fs/promises";

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
    await new Promise(resolve => setTimeout(resolve, 1500));

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
    manager["cache"].clear();

    const workflow = await manager.get("test-123");
    expect(workflow?.phase).toBe("implement");
    expect(workflow?.context).toContain("Context 1");
    expect(workflow?.decisions).toContain("Decision 1");
  });
});
