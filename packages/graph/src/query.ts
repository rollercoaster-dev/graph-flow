import { CodeParser } from "./parser.ts";
import type { GraphEntity, GraphRelationship } from "./cache.ts";

/**
 * Expand glob patterns in file list using Bun.Glob.
 * Non-glob paths are returned as-is.
 */
async function expandGlobs(patterns: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("{")) {
      const glob = new Bun.Glob(pattern);
      for await (const path of glob.scan({ dot: false })) {
        files.push(path);
      }
    } else {
      files.push(pattern);
    }
  }
  return [...new Set(files)];
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
   * Find what calls a given entity
   */
  async whatCalls(
    entityName: string,
    files: string[]
  ): Promise<WhatCallsResult | null> {
    const expandedFiles = await expandGlobs(files);

    // Parse all files
    const allEntities: GraphEntity[] = [];
    const allRelationships: GraphRelationship[] = [];

    for (const file of expandedFiles) {
      const { entities, relationships } = await this.parser.parse(file, {
        includeCallGraph: true,
      });
      allEntities.push(...entities);
      allRelationships.push(...relationships);
    }

    // Find target entity
    const entity = allEntities.find(e => e.name === entityName);
    if (!entity) {
      return null;
    }

    // Find all callers
    const callers = allRelationships
      .filter(r => r.type === "calls" && r.to === entityName)
      .map(relationship => {
        const caller = allEntities.find(e => e.name === relationship.from);
        return caller ? { caller, relationship } : null;
      })
      .filter((c): c is { caller: GraphEntity; relationship: GraphRelationship } => c !== null);

    return { entity, callers };
  }

  /**
   * Calculate blast radius - what entities are impacted by changes
   */
  async blastRadius(
    entityName: string,
    files: string[],
    maxDepth: number = 3
  ): Promise<BlastRadiusResult | null> {
    const expandedFiles = await expandGlobs(files);

    // Parse all files
    const allEntities: GraphEntity[] = [];
    const allRelationships: GraphRelationship[] = [];

    for (const file of expandedFiles) {
      const { entities, relationships } = await this.parser.parse(file, {
        includeCallGraph: true,
      });
      allEntities.push(...entities);
      allRelationships.push(...relationships);
    }

    // Find target entity
    const entity = allEntities.find(e => e.name === entityName);
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

      // Find all entities that call current
      const callers = allRelationships
        .filter(r => r.type === "calls" && r.to === current.name)
        .map(r => r.from);

      for (const caller of callers) {
        if (!visited.has(caller)) {
          const callerEntity = allEntities.find(e => e.name === caller);
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
