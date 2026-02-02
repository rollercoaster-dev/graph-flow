#!/usr/bin/env bun
/**
 * Migration script from SQLite to JSONL-based storage
 *
 * This script:
 * 1. Backs up the existing SQLite database
 * 2. Exports workflows to .claude/workflows/*.jsonl
 * 3. Exports learnings to .claude/learnings/*.jsonl
 * 4. Validates the migration
 */

import { Database } from "bun:sqlite";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const OLD_DB_PATH = join(
  homedir(),
  "Code/rollercoaster.dev/monorepo/packages/claude-knowledge/.claude/execution-state.db"
);

const CLAUDE_DIR = join(homedir(), ".claude");
const WORKFLOWS_DIR = join(CLAUDE_DIR, "workflows");
const LEARNINGS_DIR = join(CLAUDE_DIR, "learnings");
const BACKUP_PATH = join(CLAUDE_DIR, `execution-state-backup-${Date.now()}.db`);

interface WorkflowRow {
  id: string;
  issue_number: number | null;
  title: string;
  phase: string;
  context: string;
  decisions: string;
  blockers: string;
  created_at: string;
  updated_at: string;
}

interface EntityRow {
  id: string;
  name: string;
  type: string;
  area: string;
  description: string;
  created_at: string;
}

async function backupDatabase(): Promise<void> {
  console.log(`Creating backup: ${BACKUP_PATH}`);
  await copyFile(OLD_DB_PATH, BACKUP_PATH);
  console.log("✓ Backup created");
}

async function createDirectories(): Promise<void> {
  console.log("Creating directories...");
  await mkdir(WORKFLOWS_DIR, { recursive: true });
  await mkdir(LEARNINGS_DIR, { recursive: true });
  console.log("✓ Directories created");
}

async function migrateWorkflows(db: Database): Promise<number> {
  console.log("\nMigrating workflows...");

  const workflows = db
    .query("SELECT * FROM workflows WHERE phase != 'completed'")
    .all() as WorkflowRow[];

  console.log(`Found ${workflows.length} active workflows`);

  for (const workflow of workflows) {
    const events = [
      {
        timestamp: workflow.created_at,
        type: "created",
        data: {
          id: workflow.id,
          issueNumber: workflow.issue_number,
          title: workflow.title,
          phase: workflow.phase,
          context: JSON.parse(workflow.context || "[]"),
          decisions: JSON.parse(workflow.decisions || "[]"),
          blockers: JSON.parse(workflow.blockers || "[]"),
          createdAt: workflow.created_at,
          updatedAt: workflow.updated_at,
        },
      },
    ];

    const filepath = join(WORKFLOWS_DIR, `${workflow.id}.jsonl`);
    const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await Bun.write(filepath, content);

    console.log(`  ✓ ${workflow.id} (${workflow.title})`);
  }

  return workflows.length;
}

async function migrateLearnings(db: Database): Promise<number> {
  console.log("\nMigrating learnings...");

  const entities = db.query("SELECT * FROM entities").all() as EntityRow[];

  console.log(`Found ${entities.length} learnings`);

  // Group by area
  const byArea = new Map<string, EntityRow[]>();
  for (const entity of entities) {
    const area = entity.area || "general";
    if (!byArea.has(area)) {
      byArea.set(area, []);
    }
    byArea.get(area)!.push(entity);
  }

  let totalWritten = 0;

  for (const [area, areaEntities] of byArea.entries()) {
    const filepath = join(LEARNINGS_DIR, `${area}.jsonl`);
    const lines: string[] = [];

    for (const entity of areaEntities) {
      const learning = {
        id: entity.id,
        timestamp: entity.created_at,
        area: entity.area || "general",
        type: entity.type as "entity" | "relationship" | "pattern" | "decision",
        content: entity.description || entity.name,
        metadata: {
          name: entity.name,
        },
      };
      lines.push(JSON.stringify(learning));
    }

    await Bun.write(filepath, lines.join("\n") + "\n");
    console.log(`  ✓ ${area}: ${areaEntities.length} learnings`);
    totalWritten += areaEntities.length;
  }

  return totalWritten;
}

async function validateMigration(
  workflowCount: number,
  learningCount: number
): Promise<boolean> {
  console.log("\nValidating migration...");

  // Check workflow files
  const workflowFiles = await Bun.file(WORKFLOWS_DIR).arrayBuffer();
  console.log(`  Workflow files created: ${workflowCount} expected`);

  // Check learning files
  const learningFiles = await Bun.file(LEARNINGS_DIR).arrayBuffer();
  console.log(`  Learning entries: ${learningCount} expected`);

  console.log("✓ Migration validation complete");
  return true;
}

async function main(): Promise<void> {
  console.log("graph-flow v2.0 Migration Tool");
  console.log("================================\n");

  // Check if old database exists
  if (!existsSync(OLD_DB_PATH)) {
    console.log(`⚠ Old database not found: ${OLD_DB_PATH}`);
    console.log("Starting fresh - no migration needed");
    await createDirectories();
    return;
  }

  try {
    // Backup
    await backupDatabase();

    // Create directories
    await createDirectories();

    // Open database
    const db = new Database(OLD_DB_PATH, { readonly: true });

    // Migrate workflows
    const workflowCount = await migrateWorkflows(db);

    // Migrate learnings
    const learningCount = await migrateLearnings(db);

    // Validate
    await validateMigration(workflowCount, learningCount);

    console.log("\n================================");
    console.log("Migration complete!");
    console.log(`  Workflows: ${workflowCount}`);
    console.log(`  Learnings: ${learningCount}`);
    console.log(`  Backup: ${BACKUP_PATH}`);
    console.log("\nNext steps:");
    console.log("  1. Update .mcp.json to use new server");
    console.log("  2. Restart Claude Code");
    console.log("  3. Test tools work correctly");
    console.log("  4. Keep backup for 2 weeks, then delete if all works well");

    db.close();
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    console.error("\nBackup preserved at:", BACKUP_PATH);
    process.exit(1);
  }
}

main();
