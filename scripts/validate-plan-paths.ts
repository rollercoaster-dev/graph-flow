#!/usr/bin/env bun
import { readFile } from "node:fs/promises";

interface FileRule {
  path: string;
  requiredSnippets?: string[];
}

const FILE_RULES: FileRule[] = [
  {
    path: "agents/issue-researcher.md",
    requiredSnippets: [
      "`plan_path`",
      "Downstream workflows consume that value directly",
    ],
  },
  {
    path: "commands/auto-issue.md",
    requiredSnippets: ["`plan_path`"],
  },
  {
    path: "commands/work-on-issue.md",
    requiredSnippets: ["`plan_path`"],
  },
  {
    path: "skills/auto-issue/SKILL.md",
    requiredSnippets: ["`plan_path`"],
  },
  {
    path: "skills/implement/SKILL.md",
    requiredSnippets: ["`plan_path`"],
  },
];

const FORBIDDEN_PATTERNS = [
  {
    pattern:
      /Create (?:dev plan|the development plan) at `\.claude\/dev-plans\/issue-<[^`]+>`/g,
    message: "imperative hardcoded create-path instruction",
  },
  {
    pattern: /Read from `\.claude\/dev-plans\/issue-<[^`]+>`/g,
    message: "hardcoded read-path instruction",
  },
  {
    pattern: /Write to `\.claude\/dev-plans\/issue-<[^`]+>`/g,
    message: "hardcoded write-path instruction",
  },
];

function toLineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

async function main(): Promise<void> {
  const errors: string[] = [];

  for (const rule of FILE_RULES) {
    const text = await readFile(rule.path, "utf-8");

    for (const snippet of rule.requiredSnippets ?? []) {
      if (!text.includes(snippet)) {
        errors.push(`${rule.path}: missing required snippet ${JSON.stringify(snippet)}`);
      }
    }

    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const line = toLineNumber(text, match.index ?? 0);
        errors.push(`${rule.path}:${line} contains ${message}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("Plan path validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Plan path validation passed (${FILE_RULES.length} workflow files checked).`);
}

await main();
