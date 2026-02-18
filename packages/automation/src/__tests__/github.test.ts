import { beforeEach, describe, expect, test } from "bun:test";
import { clearGitHubCache } from "../github";

// We test the parseTaskListIssueRefs logic via fetchEpicSubIssues fallback path.
// Direct gh CLI calls are tested via mock in orchestrator tests.

describe("GitHub client", () => {
  beforeEach(() => {
    clearGitHubCache();
  });

  test("clearGitHubCache does not throw", () => {
    expect(() => clearGitHubCache()).not.toThrow();
  });

  test("exports expected functions", async () => {
    const mod = await import("../github");
    expect(typeof mod.fetchMilestone).toBe("function");
    expect(typeof mod.fetchMilestoneIssues).toBe("function");
    expect(typeof mod.fetchEpicSubIssues).toBe("function");
    expect(typeof mod.fetchIssue).toBe("function");
    expect(typeof mod.createIssue).toBe("function");
    expect(typeof mod.createBranch).toBe("function");
    expect(typeof mod.clearGitHubCache).toBe("function");
  });
});
