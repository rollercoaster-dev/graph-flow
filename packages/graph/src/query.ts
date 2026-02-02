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
   * Parse all files matching the given patterns and collect entities and relationships.
   */
  private async parseFiles(files: string[]): Promise<{
    entities: GraphEntity[];
    relationships: GraphRelationship[];
  }> {
    const expandedFiles = await expandGlobs(files);
    const entities: GraphEntity[] = [];
    const relationships: GraphRelationship[] = [];

    for (const file of expandedFiles) {
      const result = await this.parser.parse(file, {
        includeCallGraph: true,
      });
      entities.push(...result.entities);
      relationships.push(...result.relationships);
    }

    return { entities, relationships };
  }

  /**
   * Find what calls a given entity
   */
  async whatCalls(
    entityName: string,
    files: string[]
  ): Promise<WhatCallsResult | null> {
    const { entities, relationships } = await this.parseFiles(files);

    const entity = entities.find(e => e.name === entityName);
    if (!entity) {
      return null;
    }

    const callers = relationships
      .filter(r => r.type === "calls" && r.to === entityName)
      .map(relationship => {
        const caller = entities.find(e => e.name === relationship.from);
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
    const { entities, relationships } = await this.parseFiles(files);

    const entity = entities.find(e => e.name === entityName);
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
      const callers = relationships
        .filter(r => r.type === "calls" && r.to === current.name)
        .map(r => r.from);

      for (const caller of callers) {
        if (!visited.has(caller)) {
          const callerEntity = entities.find(e => e.name === caller);
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
