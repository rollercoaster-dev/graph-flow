#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface RequiredSnippetRule {
  path: string;
  requiredSnippets?: string[];
}

const MARKDOWN_ROOTS = ["agents", "commands", "docs", "skills"];

const REQUIRED_SNIPPET_RULES: RequiredSnippetRule[] = [
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
  {
    path: "skills/finalize/SKILL.md",
    requiredSnippets: ["`plan_path`"],
  },
];

const FORBIDDEN_PATTERNS = [
  {
    pattern: /\.claude\/dev-plans\/issue-(?:<[^>\n]+>|\d+)(?:\.md)?/g,
    message: "hardcoded plan-path reference",
  },
];

async function collectMarkdownFiles(root: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function toLineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const results = await Promise.all(
    MARKDOWN_ROOTS.map(async (root) => {
      const found = await collectMarkdownFiles(root);
      if (found.length === 0) {
        try {
          await readdir(root);
        } catch {
          errors.push(`${root}: directory not found or inaccessible`);
        }
      }
      return found;
    }),
  );
  const files = results.flat();

  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: unable to read file (${message})`);
      continue;
    }

    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const line = toLineNumber(text, match.index ?? 0);
        errors.push(`${file}:${line} contains ${message}`);
      }
    }
  }

  for (const rule of REQUIRED_SNIPPET_RULES) {
    let text: string;
    try {
      text = await readFile(rule.path, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${rule.path}: unable to read file (${message})`);
      continue;
    }

    for (const snippet of rule.requiredSnippets ?? []) {
      if (!text.includes(snippet)) {
        errors.push(`${rule.path}: missing required snippet ${JSON.stringify(snippet)}`);
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

  console.log(`Plan path validation passed (${files.length} markdown files checked).`);
}

await main();
