import { basename } from "node:path";
import { Project, SyntaxKind, type Node, type SourceFile, ts } from "ts-morph";
import { GraphCache, type GraphEntity, type GraphRelationship } from "./cache.ts";
import { parseVueSFC as parseVueSFCContent } from "./vue.ts";

export interface ParseOptions {
  includeImports?: boolean;
  includeCallGraph?: boolean;
}

/**
 * Walk up the AST to find the enclosing named entity (function, arrow fn, method).
 */
function findEnclosingEntityName(node: Node): string | null {
  let current = node.getParent();
  while (current) {
    const kind = current.getKind();

    if (kind === SyntaxKind.FunctionDeclaration) {
      return current.asKindOrThrow(SyntaxKind.FunctionDeclaration).getName() || null;
    }

    if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
      // Direct: const X = () => ...
      const parent = current.getParent()?.asKind(SyntaxKind.VariableDeclaration);
      if (parent) {
        return parent.getName();
      }
      // Wrapped: const X = memo(() => ...) / forwardRef(function() { ... })
      const callParent = current.getParent()?.asKind(SyntaxKind.CallExpression);
      const varParent = callParent?.getParent()?.asKind(SyntaxKind.VariableDeclaration);
      if (varParent) {
        return varParent.getName();
      }
    }

    if (kind === SyntaxKind.MethodDeclaration) {
      return current.asKindOrThrow(SyntaxKind.MethodDeclaration).getName();
    }

    current = current.getParent();
  }
  return null;
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
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
  }

  async init(): Promise<void> {
    await this.cache.init();
  }

  /**
   * Parse a file and extract entities and relationships.
   * If content is provided, it will be used instead of reading the file.
   */
  async parse(
    filepath: string,
    options: ParseOptions = {},
    content?: string
  ): Promise<{ entities: GraphEntity[]; relationships: GraphRelationship[] }> {
    // Read file content if not provided
    const fileContent = content ?? await Bun.file(filepath).text();

    // Check cache
    const cached = await this.cache.read(filepath, fileContent);
    if (cached) {
      return {
        entities: cached.entities,
        relationships: cached.relationships,
      };
    }

    let entities: GraphEntity[];
    let relationships: GraphRelationship[];

    if (filepath.endsWith(".vue")) {
      ({ entities, relationships } = this.parseVueSFC(filepath, fileContent, options));
    } else {
      const ext = filepath.endsWith(".tsx") || filepath.endsWith(".jsx") ? "tsx" : "ts";
      const sourceFile = this.project.createSourceFile(`temp.${ext}`, fileContent, {
        overwrite: true,
      });
      entities = this.extractEntities(sourceFile, filepath);
      relationships = this.extractRelationships(sourceFile, filepath, options);
    }

    // Cache results
    await this.cache.write(filepath, fileContent, { entities, relationships });

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

    // Variables (with React component/hook detection for arrow/function expressions)
    sourceFile.getVariableDeclarations().forEach(varDecl => {
      const name = varDecl.getName();
      let type: GraphEntity["type"] = "variable";

      const initializer = varDecl.getInitializer();
      if (initializer) {
        const initKind = initializer.getKind();
        const isFunctionLike = initKind === SyntaxKind.ArrowFunction || initKind === SyntaxKind.FunctionExpression;

        // Also detect wrapper patterns like memo(() => ...), forwardRef(function() { ... })
        const isWrappedFunction = initKind === SyntaxKind.CallExpression && (() => {
          const callExpr = initializer.asKindOrThrow(SyntaxKind.CallExpression);
          const callee = callExpr.getExpression().getText();
          if (!/^(memo|forwardRef|React\.memo|React\.forwardRef)$/.test(callee)) return false;
          const firstArg = callExpr.getArguments()[0];
          if (!firstArg) return false;
          const argKind = firstArg.getKind();
          return argKind === SyntaxKind.ArrowFunction || argKind === SyntaxKind.FunctionExpression;
        })();

        if (isFunctionLike || isWrappedFunction) {
          if (/^use[A-Z]/.test(name)) {
            type = "hook";
          } else if (/^[A-Z]/.test(name)) {
            type = "component";
          }
        }
      }

      entities.push({
        name,
        type,
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
        const expr = call.getExpression();
        // For simple identifiers use the name directly; for property access (a.b.c)
        // use the last name to avoid noisy chained expressions in the graph.
        let callName: string;
        if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
          const pae = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
          callName = pae.getName();
        } else if (expr.getKind() === SyntaxKind.Identifier) {
          callName = expr.getText();
        } else {
          // Fallback for complex expressions (element access, etc.)
          callName = expr.getText();
        }
        const enclosingName = findEnclosingEntityName(call);
        if (enclosingName) {
          relationships.push({
            from: enclosingName,
            to: callName,
            type: "calls",
            location: {
              file: filepath,
              line: call.getStartLineNumber() + lineOffset,
            },
          });
        }
      });

      // JSX element usage (React components)
      const jsxKinds = [SyntaxKind.JsxOpeningElement, SyntaxKind.JsxSelfClosingElement];
      for (const kind of jsxKinds) {
        sourceFile.getDescendantsOfKind(kind).forEach(jsx => {
          const tagName = jsx.getTagNameNode().getText();

          // Skip intrinsic HTML/SVG elements (lowercase)
          if (/^[a-z]/.test(tagName)) return;

          const enclosingName = findEnclosingEntityName(jsx);
          if (enclosingName) {
            relationships.push({
              from: enclosingName,
              to: tagName,
              type: "calls",
              location: {
                file: filepath,
                line: jsx.getStartLineNumber() + lineOffset,
              },
            });
          }
        });
      }
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
