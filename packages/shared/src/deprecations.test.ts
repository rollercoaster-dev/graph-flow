import { describe, expect, it } from "bun:test";
import { resolveDeprecatedToolCall } from "./deprecations";

describe("resolveDeprecatedToolCall", () => {
  it("maps p-planget to p-progress", () => {
    const result = resolveDeprecatedToolCall("p-planget", { goalId: "goal-1" });
    expect(result.name).toBe("p-progress");
    expect(result.args).toEqual({ goalId: "goal-1" });
    expect(result.warning).toContain("deprecated");
  });

  it("maps p-step-update to p-sync manualOverrides", () => {
    const result = resolveDeprecatedToolCall("p-step-update", {
      stepId: "step-1",
      status: "done",
    });
    expect(result.name).toBe("p-sync");
    expect(result.args).toEqual({
      manualOverrides: [{ stepId: "step-1", status: "done" }],
    });
  });

  it("maps p-step-update clear mode to p-sync clearOverrides", () => {
    const result = resolveDeprecatedToolCall("p-step-update", {
      stepId: "step-1",
      clear: true,
    });
    expect(result.name).toBe("p-sync");
    expect(result.args).toEqual({ clearOverrides: ["step-1"] });
  });

  it("maps a-from-milestone to a-import", () => {
    const result = resolveDeprecatedToolCall("a-from-milestone", {
      milestoneNumber: 42,
    });
    expect(result.name).toBe("a-import");
    expect(result.args).toEqual({ type: "milestone", number: 42 });
  });

  it("maps a-start-issue to p-goal", () => {
    const result = resolveDeprecatedToolCall("a-start-issue", {
      issueNumber: 123,
      description: "Investigate bug",
    });
    expect(result.name).toBe("p-goal");
    expect(result.args).toEqual({
      title: "Issue #123",
      description: "Investigate bug",
      issueNumber: 123,
    });
  });

  it("passes through non-deprecated tools", () => {
    const result = resolveDeprecatedToolCall("g-calls", { name: "foo" });
    expect(result.name).toBe("g-calls");
    expect(result.args).toEqual({ name: "foo" });
    expect(result.warning).toBeUndefined();
  });
});
