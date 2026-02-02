import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { GraphCache, type GraphEntity, type GraphRelationship } from "./cache.ts";

export interface ParseOptions {
  includeImports?: boolean;
  includeCallGraph?: boolean;
}

/**
 * TypeScript/JavaScript code parser using ts-morph
 */
export class CodeParser {
  private cache: GraphCache;
  private project: Project;

  constructor(cacheDir: string) {
    this.cache = new GraphCache(cacheDir);
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
    });
  }

  async init(): Promise<void> {
    await this.cache.init();
  }

  /**
   * Parse a file and extract entities and relationships
   */
  async parse(
    filepath: string,
    options: ParseOptions = {}
  ): Promise<{ entities: GraphEntity[]; relationships: GraphRelationship[] }> {
    // Read file content
    const content = await Bun.file(filepath).text();

    // Check cache
    const cached = await this.cache.read(filepath, content);
    if (cached) {
      return {
        entities: cached.entities,
        relationships: cached.relationships,
      };
    }

    // Parse file
    const sourceFile = this.project.createSourceFile("temp.ts", content, {
      overwrite: true,
    });

    const entities = this.extractEntities(sourceFile, filepath);
    const relationships = this.extractRelationships(sourceFile, filepath, options);

    // Cache results
    await this.cache.write(filepath, content, { entities, relationships });

    return { entities, relationships };
  }

  /**
   * Extract entities (functions, classes, etc.)
   */
  private extractEntities(sourceFile: SourceFile, filepath: string): GraphEntity[] {
    const entities: GraphEntity[] = [];

    // Functions
    sourceFile.getFunctions().forEach(fn => {
      const name = fn.getName();
      if (name) {
        entities.push({
          name,
          type: "function",
          location: {
            file: filepath,
            line: fn.getStartLineNumber(),
          },
          signature: fn.getSignature().getDeclaration().getText(),
        });
      }
    });

    // Classes
    sourceFile.getClasses().forEach(cls => {
      entities.push({
        name: cls.getName() || "AnonymousClass",
        type: "class",
        location: {
          file: filepath,
          line: cls.getStartLineNumber(),
        },
      });
    });

    // Interfaces
    sourceFile.getInterfaces().forEach(iface => {
      entities.push({
        name: iface.getName(),
        type: "interface",
        location: {
          file: filepath,
          line: iface.getStartLineNumber(),
        },
      });
    });

    // Type aliases
    sourceFile.getTypeAliases().forEach(typeAlias => {
      entities.push({
        name: typeAlias.getName(),
        type: "type",
        location: {
          file: filepath,
          line: typeAlias.getStartLineNumber(),
        },
      });
    });

    // Variables
    sourceFile.getVariableDeclarations().forEach(varDecl => {
      entities.push({
        name: varDecl.getName(),
        type: "variable",
        location: {
          file: filepath,
          line: varDecl.getStartLineNumber(),
        },
      });
    });

    return entities;
  }

  /**
   * Extract relationships (calls, imports, etc.)
   */
  private extractRelationships(
    sourceFile: SourceFile,
    filepath: string,
    options: ParseOptions
  ): GraphRelationship[] {
    const relationships: GraphRelationship[] = [];

    // Imports
    if (options.includeImports !== false) {
      sourceFile.getImportDeclarations().forEach(importDecl => {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        importDecl.getNamedImports().forEach(namedImport => {
          relationships.push({
            from: filepath,
            to: `${moduleSpecifier}#${namedImport.getName()}`,
            type: "imports",
            location: {
              file: filepath,
              line: importDecl.getStartLineNumber(),
            },
          });
        });
      });
    }

    // Function calls
    if (options.includeCallGraph !== false) {
      sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
        const expression = call.getExpression();
        const callName = expression.getText();

        // Find enclosing function
        const enclosingFn = call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
        if (enclosingFn) {
          const fromName = enclosingFn.getName();
          if (fromName) {
            relationships.push({
              from: fromName,
              to: callName,
              type: "calls",
              location: {
                file: filepath,
                line: call.getStartLineNumber(),
              },
            });
          }
        }
      });
    }

    return relationships;
  }

  /**
   * Clear cache for a file
   */
  async invalidateCache(filepath: string): Promise<void> {
    await this.cache.invalidate(filepath);
  }
}
