/**
 * Docs Graph Search
 *
 * Semantic search over indexed DocSection entities using the knowledge
 * package's embedding provider. Falls back to keyword search when
 * embeddings are unavailable.
 *
 * Also provides graph traversal: getDocsForCode / getCodeForDoc.
 */

import {
  EmbeddingStorage,
  getDefaultEmbedder,
} from "@graph-flow/knowledge";
import { cosineSimilarity } from "@graph-flow/knowledge/embeddings";
import type { DocSection, DocsGraph, DocSearchResult, DocSearchOptions } from "./types.ts";

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
   * Generate and store embeddings for newly indexed sections.
   * Only generates for sections that don't already have an embedding.
   */
  async embedSections(
    sections: DocSection[],
    existingIds: Set<string>,
  ): Promise<void> {
    const embedder = await getDefaultEmbedder();

    for (const section of sections) {
      if (existingIds.has(section.id)) continue;

      try {
        const text = `${section.heading}\n\n${section.content}`;
        const embedding = await embedder.generate(text);
        await this.embeddingStorage.store(EMBEDDINGS_AREA, section.id, embedding);
      } catch {
        // Non-blocking — section still indexed without embedding
      }
    }
  }

  /**
   * Semantic search over all indexed doc sections.
   */
  async search(
    graph: DocsGraph,
    query: string,
    options: DocSearchOptions = {},
  ): Promise<DocSearchResult[]> {
    const { limit = 10, threshold = 0.3 } = options;

    const embedder = await getDefaultEmbedder();
    const queryEmbedding = await embedder.generate(query);

    const allEmbeddings = await this.embeddingStorage.readAll(EMBEDDINGS_AREA);
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
  }

  /**
   * Find all doc sections that document a given code entity name.
   * Uses the DOCUMENTS relationship graph (codeToDoc map).
   */
  getDocsForCode(
    graph: DocsGraph,
    entityName: string,
  ): DocSection[] {
    const sectionIds = graph.codeToDoc[entityName] ?? [];
    return sectionIds
      .map((id) => graph.sections[id])
      .filter((s): s is DocSection => s !== undefined);
  }

  /**
   * Find all code entity names documented by a given section.
   * Uses the reverse DOCUMENTS relationship (docToCode map).
   */
  getCodeForDoc(
    graph: DocsGraph,
    sectionId: string,
  ): string[] {
    return graph.docToCode[sectionId] ?? [];
  }
}
