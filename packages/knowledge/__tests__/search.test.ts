import { describe, expect, test } from "bun:test";
import { LearningSearch } from "../src/search.ts";
import type { LearningRecord } from "../src/storage.ts";

describe("LearningSearch", () => {
  const search = new LearningSearch();

  const learnings: LearningRecord[] = [
    {
      id: "1",
      timestamp: "2024-01-01T00:00:00Z",
      area: "auth",
      type: "entity",
      content: "User authentication uses JWT tokens stored in httpOnly cookies",
    },
    {
      id: "2",
      timestamp: "2024-01-01T00:00:01Z",
      area: "auth",
      type: "pattern",
      content:
        "Authentication middleware validates JWT and attaches user to request",
    },
    {
      id: "3",
      timestamp: "2024-01-01T00:00:02Z",
      area: "api",
      type: "entity",
      content: "API endpoints are defined in express router with rate limiting",
    },
  ];

  test("should find learnings by text search", () => {
    const results = search.search("JWT authentication", learnings);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].area).toBe("auth");
  });

  test("should boost results matching area", () => {
    const results = search.search("authentication", learnings);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.area === "auth")).toBe(true);
  });

  test("should return empty array for no matches", () => {
    const results = search.search("nonexistent term xyz", learnings);
    expect(results.length).toBe(0);
  });

  test("should limit results", () => {
    const results = search.search("authentication", learnings, 1);
    expect(results.length).toBe(1);
  });

  test("should handle empty query", () => {
    const results = search.search("", learnings);
    expect(results.length).toBe(0);
  });
});
