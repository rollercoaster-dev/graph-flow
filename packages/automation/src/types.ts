/**
 * Automation Types
 *
 * Type definitions for GitHub automation workflows.
 */

export interface GitHubMilestone {
  number: number;
  title: string;
  description: string;
  state: "open" | "closed";
  openIssues: number;
  closedIssues: number;
  url: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  labels: string[];
  url: string;
  milestone?: { number: number; title: string };
}

export interface GitHubSubIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
}

export interface AutomationResult {
  goalId: string;
  planId: string;
  stepIds: string[];
  issueCount: number;
  summary: string;
}

export interface IssueCreationResult {
  number: number;
  url: string;
  stepId?: string;
}

export type BoardUpdateResult =
  | { issueNumber: number; itemId: string; status: string; success: true }
  | {
      issueNumber: number;
      itemId: string;
      status: string;
      success: false;
      error: string;
    };
