import { basename } from "node:path";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { GraphCache, type GraphEntity, type GraphRelationship } from "./cache.ts";
import { parseVueSFC as parseVueSFCContent } from "./vue.ts";

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

    let entities: GraphEntity[];
    let relationships: GraphRelationship[];

    if (filepath.endsWith(".vue")) {
      ({ entities, relationships } = this.parseVueSFC(filepath, content, options));
    } else {
      const sourceFile = this.project.createSourceFile("temp.ts", content, {
        overwrite: true,
      });
      entities = this.extractEntities(sourceFile, filepath);
      relationships = this.extractRelationships(sourceFile, filepath, options);
    }

    // Cache results
    await this.cache.write(filepath, content, { entities, relationships });

    return { entities, relationships };
  }

  /**
   * Parse a Vue SFC and extract entities/relationships from script blocks and template.
   */
  private parseVueSFC(
    filepath: string,
    content: string,
    options: ParseOptions
  ): { entities: GraphEntity[]; relationships: GraphRelationship[] } {
    const { scripts, templateComponents } = parseVueSFCContent(content);

    const entities: GraphEntity[] = [];
    const relationships: GraphRelationship[] = [];

    for (const script of scripts) {
      const ext = script.lang === "ts" ? "ts" : "js";
      const sourceFile = this.project.createSourceFile(`temp.${ext}`, script.content, {
        overwrite: true,
      });

      // startLine points to the <script> tag line. The extracted content begins with a
      // leading newline, so ts-morph line 1 = that newline, line 2 = first real code.
      // Subtract 1 so that (ts-morph line + offset) equals the .vue file line.
      const lineOffset = script.startLine - 1;
      entities.push(...this.extractEntities(sourceFile, filepath, lineOffset));
      relationships.push(...this.extractRelationships(sourceFile, filepath, options, lineOffset));

      // For <script setup> files, add a component entity derived from the filename
      if (script.setup) {
        const componentName = basename(filepath, ".vue");
        entities.push({
          name: componentName,
          type: "component",
          location: { file: filepath, line: 1 },
        });
      }
    }

    // Template component usage → "uses" relationships
    for (const name of templateComponents.names) {
      relationships.push({
        from: filepath,
        to: name,
        type: "uses",
        location: { file: filepath, line: 1 },
      });
    }

    return { entities, relationships };
  }

  /**
   * Extract entities (functions, classes, etc.)
   */
  private extractEntities(sourceFile: SourceFile, filepath: string, lineOffset = 0): GraphEntity[] {
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
            line: fn.getStartLineNumber() + lineOffset,
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
          line: cls.getStartLineNumber() + lineOffset,
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
          line: iface.getStartLineNumber() + lineOffset,
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
          line: typeAlias.getStartLineNumber() + lineOffset,
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
          line: varDecl.getStartLineNumber() + lineOffset,
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
    options: ParseOptions,
    lineOffset = 0
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
              line: importDecl.getStartLineNumber() + lineOffset,
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
                line: call.getStartLineNumber() + lineOffset,
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
