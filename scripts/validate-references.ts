#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

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
  const roots = ["commands", "docs"];
  const files = (await Promise.all(roots.map((r) => collectMarkdownFiles(r)))).flat();

  const errors: string[] = [];

  for (const file of files) {
    const text = await readFile(file, "utf-8");

    const skillRegex = /Skill\(graph-flow:([a-z0-9-]+)/g;
    for (const match of text.matchAll(skillRegex)) {
      const skillName = match[1];
      const line = toLineNumber(text, match.index ?? 0);
      const skillPath = join("skills", skillName, "SKILL.md");
      if (!existsSync(skillPath)) {
        errors.push(
          `${file}:${line} references missing skill "${skillName}" (${skillPath})`,
        );
      }
    }

    const commandRegex = /\/graph-flow:([a-z0-9-]+)/g;
    for (const match of text.matchAll(commandRegex)) {
      const commandName = match[1];
      const line = toLineNumber(text, match.index ?? 0);
      const commandPath = join("commands", `${commandName}.md`);
      if (!existsSync(commandPath)) {
        errors.push(
          `${file}:${line} references missing command "${commandName}" (${commandPath})`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error("Reference validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Reference validation passed (${files.length} markdown files checked).`);
}

await main();
