/**
 * Docs Graph Search
 *
 * Semantic search over indexed DocSection entities using the knowledge
 * package's embedding provider. Falls back to keyword search when
 * embeddings are unavailable.
 *
 * Also provides graph traversal: getDocsForCode / getCodeForDoc.
 */

import { EmbeddingStorage, getDefaultEmbedder } from "@graph-flow/knowledge";
import { cosineSimilarity } from "@graph-flow/knowledge/embeddings";
import type {
  DocSearchOptions,
  DocSearchResult,
  DocSection,
  DocsGraph,
} from "./types.ts";

const EMBEDDINGS_AREA = "docs";

/**
 * Manages embeddings for doc sections and provides semantic search.
 */
export class DocsSearch {
  private embeddingStorage: EmbeddingStorage;

  constructor(embeddingsDir: string) {
    this.embeddingStorage = new EmbeddingStorage(embeddingsDir);
  }

  async init(): Promise<void> {
    await this.embeddingStorage.init();
  }

  /**
   * Returns the set of section IDs that already have stored embeddings.
   * Used by callers to skip re-embedding unchanged sections.
   */
  async getExistingEmbeddingIds(): Promise<Set<string>> {
    const all = await this.embeddingStorage.readAll(EMBEDDINGS_AREA);
    return new Set(all.keys());
  }

  /**
   * Generate and store embeddings for newly indexed sections.
   * Only generates for sections that don't already have an embedding.
   */
  async embedSections(
    sections: DocSection[],
    existingIds: Set<string>,
  ): Promise<void> {
    for (const section of sections) {
      if (existingIds.has(section.id)) continue;

      try {
        const embedder = await getDefaultEmbedder();
        const text = `${section.heading}\n\n${section.content}`;
        const embedding = await embedder.generate(text);
        await this.embeddingStorage.store(
          EMBEDDINGS_AREA,
          section.id,
          embedding,
        );
      } catch (error) {
        // Non-blocking: section is indexed but will be excluded from semantic search.
        console.error(
          `[docs/search] Failed to embed section "${section.id}" (${section.heading}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Search over all indexed doc sections.
   * Attempts semantic search using vector embeddings. If the embedder is
   * unavailable or fails, falls back to keyword matching (term overlap score).
   */
  async search(
    graph: DocsGraph,
    query: string,
    options: DocSearchOptions = {},
  ): Promise<DocSearchResult[]> {
    const { limit = 10, threshold = 0.3 } = options;

    try {
      const embedder = await getDefaultEmbedder();
      const queryEmbedding = await embedder.generate(query);

      const allEmbeddings =
        await this.embeddingStorage.readAll(EMBEDDINGS_AREA);
      const scored: DocSearchResult[] = [];

      for (const [id, embedding] of allEmbeddings) {
        const section = graph.sections[id];
        if (!section) continue;

        const similarity = cosineSimilarity(queryEmbedding, embedding);
        if (similarity >= threshold) {
          scored.push({ section, similarity });
        }
      }

      scored.sort((a, b) => b.similarity - a.similarity);
      return scored.slice(0, limit);
    } catch (error) {
      console.error(
        `[docs/search] Semantic search failed, falling back to keyword search: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.keywordSearch(graph, query, limit);
    }
  }

  /**
   * Keyword fallback search: tokenizes the query and scores sections by
   * matching term overlap ratio.
   */
  private keywordSearch(
    graph: DocsGraph,
    query: string,
    limit: number,
  ): DocSearchResult[] {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    if (queryTerms.length === 0) return [];

    const scored: DocSearchResult[] = [];
    for (const section of Object.values(graph.sections)) {
      const text = `${section.heading} ${section.content}`.toLowerCase();
      const matched = queryTerms.filter((t) => text.includes(t)).length;
      if (matched > 0) {
        const similarity = matched / queryTerms.length;
        scored.push({ section, similarity });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  /**
   * Find all doc sections that document a given code entity name.
   * Uses the DOCUMENTS relationship graph (codeToDoc map).
   */
  getDocsForCode(graph: DocsGraph, entityName: string): DocSection[] {
    const sectionIds = graph.codeToDoc[entityName] ?? [];
    return sectionIds
      .map((id) => graph.sections[id])
      .filter((s): s is DocSection => s !== undefined);
  }

  /**
   * Find all code entity names documented by a given section.
   * Uses the reverse DOCUMENTS relationship (docToCode map).
   */
  getCodeForDoc(graph: DocsGraph, sectionId: string): string[] {
    return graph.docToCode[sectionId] ?? [];
  }
}
