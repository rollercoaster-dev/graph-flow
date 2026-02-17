import { expandGlobs } from "@graph-flow/shared";
import type { GraphEntity, GraphRelationship } from "./cache.ts";
import { CodeParser } from "./parser.ts";

/**
 * Default source file patterns for auto-detection.
 * Covers standard TypeScript/JavaScript project layouts.
 */
const DEFAULT_SOURCE_PATTERNS = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
  "lib/**/*.ts",
  "app/**/*.ts",
  "app/**/*.tsx",
];

/**
 * Resolve the files to search, falling back to auto-detected source files
 * when none are provided.
 */
async function resolveFiles(files?: string[], cwd?: string): Promise<string[]> {
  if (files && files.length > 0) {
    return expandGlobs(files, cwd);
  }

  // Auto-detect: try default patterns, fall back to **\/*.ts if nothing found
  const detected = await expandGlobs(DEFAULT_SOURCE_PATTERNS, cwd);
  if (detected.length > 0) {
    return detected;
  }

  return expandGlobs(["**/*.ts", "**/*.tsx", "**/*.js"], cwd);
}

export interface WhatCallsResult {
  entity: GraphEntity;
  callers: Array<{
    caller: GraphEntity;
    relationship: GraphRelationship;
  }>;
}

export interface BlastRadiusResult {
  entity: GraphEntity;
  impactedEntities: Array<{
    entity: GraphEntity;
    distance: number;
    path: string[];
  }>;
}

/**
 * Graph query operations
 */
export class GraphQuery {
  private parser: CodeParser;

  constructor(cacheDir: string) {
    this.parser = new CodeParser(cacheDir);
  }

  async init(): Promise<void> {
    await this.parser.init();
  }

  /**
   * Parse all files matching the given patterns and collect entities and relationships.
   */
  private async parseFiles(files: string[]): Promise<{
    entities: GraphEntity[];
    relationships: GraphRelationship[];
  }> {
    const entities: GraphEntity[] = [];
    const relationships: GraphRelationship[] = [];

    for (const file of files) {
      const result = await this.parser.parse(file, {
        includeCallGraph: true,
      });
      entities.push(...result.entities);
      relationships.push(...result.relationships);
    }

    return { entities, relationships };
  }

  /**
   * Find what calls a given entity.
   * If files is omitted, auto-detects source files from cwd.
   */
  async whatCalls(
    entityName: string,
    files?: string[],
    cwd?: string,
  ): Promise<WhatCallsResult | null> {
    const resolvedFiles = await resolveFiles(files, cwd);
    const { entities, relationships } = await this.parseFiles(resolvedFiles);

    const entity = entities.find((e) => e.name === entityName);
    if (!entity) {
      return null;
    }

    const callers = relationships
      .filter((r) => r.type === "calls" && r.to === entityName)
      .map((relationship) => {
        const caller = entities.find((e) => e.name === relationship.from);
        return caller ? { caller, relationship } : null;
      })
      .filter(
        (c): c is { caller: GraphEntity; relationship: GraphRelationship } =>
          c !== null,
      );

    return { entity, callers };
  }

  /**
   * Calculate blast radius — what entities are impacted by changes.
   * If files is omitted, auto-detects source files from cwd.
   */
  async blastRadius(
    entityName: string,
    files?: string[],
    maxDepth: number = 3,
    cwd?: string,
  ): Promise<BlastRadiusResult | null> {
    const resolvedFiles = await resolveFiles(files, cwd);
    const { entities, relationships } = await this.parseFiles(resolvedFiles);

    const entity = entities.find((e) => e.name === entityName);
    if (!entity) {
      return null;
    }

    // BFS to find impacted entities
    const visited = new Set<string>();
    const impactedEntities: BlastRadiusResult["impactedEntities"] = [];
    const queue: Array<{ name: string; distance: number; path: string[] }> = [
      { name: entityName, distance: 0, path: [entityName] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.name) || current.distance > maxDepth) {
        continue;
      }

      visited.add(current.name);

      const callers = relationships
        .filter((r) => r.type === "calls" && r.to === current.name)
        .map((r) => r.from);

      for (const caller of callers) {
        if (!visited.has(caller)) {
          const callerEntity = entities.find((e) => e.name === caller);
          if (callerEntity && caller !== entityName) {
            impactedEntities.push({
              entity: callerEntity,
              distance: current.distance + 1,
              path: [...current.path, caller],
            });
          }

          queue.push({
            name: caller,
            distance: current.distance + 1,
            path: [...current.path, caller],
          });
        }
      }
    }

    return { entity, impactedEntities };
  }

  /**
   * Get all definitions in a file
   */
  async getDefinitions(filepath: string): Promise<GraphEntity[]> {
    const { entities } = await this.parser.parse(filepath, {
      includeCallGraph: false,
    });
    return entities;
  }
}
