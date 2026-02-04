/**
 * GitHub Client
 *
 * Wraps the `gh` CLI for GitHub API interactions.
 * Uses spawnSync from Bun (same pattern as resolvers.ts).
 */

import { spawnSync } from "bun";
import type {
  GitHubMilestone,
  GitHubIssue,
  GitHubSubIssue,
} from "./types";

// 5-minute cache (same pattern as resolvers.ts)
const cache = new Map<string, { data: unknown; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.data as T;
  }
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

/** Clear cache (for testing). */
export function clearGitHubCache(): void {
  cache.clear();
}

/**
 * Run a `gh` CLI command and return parsed JSON output.
 */
function ghJson<T>(args: string[]): T | null {
  try {
    const result = spawnSync(["gh", ...args]);
    if (result.success) {
      return JSON.parse(result.stdout.toString()) as T;
    }
    const stderr = result.stderr.toString().trim();
    if (stderr) {
      console.error(`gh ${args[0]} failed: ${stderr}`);
    }
  } catch {
    // gh not available or JSON parse failure
  }
  return null;
}

/**
 * Run a `gh` CLI command and return raw stdout.
 */
function ghRaw(args: string[]): string | null {
  try {
    const result = spawnSync(["gh", ...args]);
    if (result.success) {
      return result.stdout.toString().trim();
    }
  } catch {
    // gh not available
  }
  return null;
}

/**
 * Fetch a milestone by number.
 */
export function fetchMilestone(num: number): GitHubMilestone | null {
  const cacheKey = `milestone:${num}`;
  const cached = getCached<GitHubMilestone>(cacheKey);
  if (cached) return cached;

  const data = ghJson<{
    number: number;
    title: string;
    description: string;
    state: string;
    openIssues: number;
    closedIssues: number;
    url: string;
  }>(["api", `repos/{owner}/{repo}/milestones/${num}`]);

  if (!data) return null;

  const milestone: GitHubMilestone = {
    number: data.number,
    title: data.title,
    description: data.description || "",
    state: data.state === "open" ? "open" : "closed",
    openIssues: data.openIssues ?? data.openIssues,
    closedIssues: data.closedIssues ?? data.closedIssues,
    url: data.url || "",
  };

  setCache(cacheKey, milestone);
  return milestone;
}

/**
 * Fetch issues belonging to a milestone.
 */
export function fetchMilestoneIssues(milestoneNum: number): GitHubIssue[] {
  const cacheKey = `milestone-issues:${milestoneNum}`;
  const cached = getCached<GitHubIssue[]>(cacheKey);
  if (cached) return cached;

  const data = ghJson<
    Array<{
      number: number;
      title: string;
      body: string;
      state: string;
      labels: Array<{ name: string }>;
      url: string;
      milestone?: { number: number; title: string };
    }>
  >([
    "issue",
    "list",
    "--milestone",
    String(milestoneNum),
    "--state",
    "all",
    "--json",
    "number,title,body,state,labels,url,milestone",
    "--limit",
    "100",
  ]);

  if (!data) return [];

  const issues: GitHubIssue[] = data.map((d) => ({
    number: d.number,
    title: d.title,
    body: d.body || "",
    state: d.state === "OPEN" ? "OPEN" : "CLOSED",
    labels: d.labels.map((l) => l.name),
    url: d.url || "",
    milestone: d.milestone,
  }));

  setCache(cacheKey, issues);
  return issues;
}

/**
 * Fetch sub-issues from an epic issue.
 * Tries GraphQL sub-issues API first, falls back to parsing task list references.
 */
export function fetchEpicSubIssues(epicNum: number): GitHubSubIssue[] {
  const cacheKey = `epic-sub-issues:${epicNum}`;
  const cached = getCached<GitHubSubIssue[]>(cacheKey);
  if (cached) return cached;

  // Try GraphQL sub-issues API first
  const graphqlResult = ghJson<{
    data?: {
      repository?: {
        issue?: {
          subIssues?: {
            nodes?: Array<{
              number: number;
              title: string;
              state: string;
            }>;
          };
        };
      };
    };
  }>([
    "api",
    "graphql",
    "-f",
    `query=query { repository(owner: "{owner}", name: "{repo}") { issue(number: ${epicNum}) { subIssues(first: 100) { nodes { number title state } } } } }`,
  ]);

  const nodes =
    graphqlResult?.data?.repository?.issue?.subIssues?.nodes;
  if (nodes && nodes.length > 0) {
    const subIssues: GitHubSubIssue[] = nodes.map((n) => ({
      number: n.number,
      title: n.title,
      state: n.state === "OPEN" ? "OPEN" : "CLOSED",
    }));
    setCache(cacheKey, subIssues);
    return subIssues;
  }

  // Fallback: parse task list references from epic body
  const epic = fetchIssue(epicNum);
  if (!epic) return [];

  const subIssues = parseTaskListIssueRefs(epic.body);
  setCache(cacheKey, subIssues);
  return subIssues;
}

/**
 * Parse issue references from markdown task lists.
 * Matches patterns like `- [ ] #42` or `- [x] #42 title`.
 */
function parseTaskListIssueRefs(body: string): GitHubSubIssue[] {
  const refs: GitHubSubIssue[] = [];
  const regex = /^- \[([ x])\] #(\d+)\b(.*)/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    const completed = match[1] === "x";
    const number = parseInt(match[2], 10);
    const title = match[3].trim() || `Issue #${number}`;

    refs.push({
      number,
      title,
      state: completed ? "CLOSED" : "OPEN",
    });
  }

  return refs;
}

/**
 * Fetch a single issue by number.
 */
export function fetchIssue(num: number): GitHubIssue | null {
  const cacheKey = `issue:${num}`;
  const cached = getCached<GitHubIssue>(cacheKey);
  if (cached) return cached;

  const data = ghJson<{
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
    milestone?: { number: number; title: string };
  }>([
    "issue",
    "view",
    String(num),
    "--json",
    "number,title,body,state,labels,url,milestone",
  ]);

  if (!data) return null;

  const issue: GitHubIssue = {
    number: data.number,
    title: data.title,
    body: data.body || "",
    state: data.state === "OPEN" ? "OPEN" : "CLOSED",
    labels: data.labels.map((l) => l.name),
    url: data.url || "",
    milestone: data.milestone,
  };

  setCache(cacheKey, issue);
  return issue;
}

/**
 * Create a new GitHub issue.
 */
export function createIssue(opts: {
  title: string;
  body?: string;
  labels?: string[];
  milestone?: number;
}): { number: number; url: string } | null {
  const args = ["issue", "create", "--title", opts.title];

  if (opts.body) {
    args.push("--body", opts.body);
  }
  if (opts.labels && opts.labels.length > 0) {
    args.push("--label", opts.labels.join(","));
  }
  if (opts.milestone !== undefined) {
    args.push("--milestone", String(opts.milestone));
  }

  const url = ghRaw(args);
  if (!url) return null;

  // gh issue create outputs the issue URL; extract number from it
  const match = url.match(/\/issues\/(\d+)$/);
  if (!match) return null;

  return {
    number: parseInt(match[1], 10),
    url,
  };
}

/**
 * Create a git branch and push it to the remote.
 */
export function createBranch(name: string): boolean {
  const checkout = spawnSync(["git", "checkout", "-b", name]);
  if (!checkout.success) return false;

  const push = spawnSync(["git", "push", "-u", "origin", name]);
  return push.success;
}
