import { LearningStorage, type LearningRecord } from "./storage.ts";
import { EmbeddingStorage } from "./embeddings-storage.ts";
import { getDefaultEmbedder, floatArrayToBuffer, bufferToFloatArray } from "./embeddings";
import { cosineSimilarity } from "./embeddings/similarity";

export interface SemanticSearchOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity threshold 0.0-1.0 (default: 0.3) */
  threshold?: number;
  /** Specific area to search in (optional) */
  area?: string;
}

export interface SemanticSearchResult {
  learning: LearningRecord;
  similarity: number;
}

/**
 * Semantic search for learnings using vector embeddings
 */
export class SemanticSearch {
  private learningStorage: LearningStorage;
  private embeddingStorage: EmbeddingStorage;

  constructor(learningsDir: string, embeddingsDir: string) {
    this.learningStorage = new LearningStorage(learningsDir);
    this.embeddingStorage = new EmbeddingStorage(embeddingsDir);
  }

  async init(): Promise<void> {
    await this.learningStorage.init();
    await this.embeddingStorage.init();
  }

  /**
   * Generate and store embedding for a learning
   */
  async generateAndStoreEmbedding(learning: LearningRecord): Promise<void> {
    try {
      const embedder = await getDefaultEmbedder();
      const embedding = await embedder.generate(learning.content);

      if (embedding) {
        await this.embeddingStorage.store(learning.area, learning.id, embedding);
      }
    } catch (error) {
      console.error(`Failed to generate embedding for learning ${learning.id}:`, error);
      // Non-blocking - learning still stored without embedding
    }
  }

  /**
   * Search for semantically similar learnings
   */
  async search(
    queryText: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const { limit = 10, threshold = 0.3, area } = options;

    // Generate query embedding
    const embedder = await getDefaultEmbedder();
    const queryEmbedding = await embedder.generate(queryText);

    if (!queryEmbedding) {
      console.error("Failed to generate query embedding");
      return [];
    }

    // Get learnings and embeddings
    const learnings = area
      ? await this.learningStorage.readArea(area)
      : await this.learningStorage.readAll();

    // Get embeddings for relevant areas
    const areas = area ? [area] : await this.learningStorage.listAreas();
    const allEmbeddings = new Map<string, Float32Array>();

    for (const areaName of areas) {
      const areaEmbeddings = await this.embeddingStorage.readAll(areaName);
      for (const [id, embedding] of areaEmbeddings) {
        allEmbeddings.set(id, embedding);
      }
    }

    // Calculate similarities
    const scored: SemanticSearchResult[] = [];

    for (const learning of learnings) {
      const embedding = allEmbeddings.get(learning.id);
      if (!embedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, embedding);

      if (similarity >= threshold) {
        scored.push({ learning, similarity });
      }
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit);
  }

  /**
   * Find similar learnings to a given learning
   */
  async findSimilar(
    learningId: string,
    options: Omit<SemanticSearchOptions, "area"> = {}
  ): Promise<SemanticSearchResult[]> {
    const { limit = 5, threshold = 0.3 } = options;

    // Find the target learning
    const allLearnings = await this.learningStorage.readAll();
    const targetLearning = allLearnings.find(l => l.id === learningId);

    if (!targetLearning) {
      return [];
    }

    // Load embeddings for all areas so we can compare across the full corpus
    const allEmbeddings = new Map<string, Float32Array>();
    const areas = await this.learningStorage.listAreas();
    for (const areaName of areas) {
      const areaEmbeddings = await this.embeddingStorage.readAll(areaName);
      for (const [id, embedding] of areaEmbeddings) {
        allEmbeddings.set(id, embedding);
      }
    }

    // Get target embedding
    const targetEmbedding = allEmbeddings.get(learningId);

    if (!targetEmbedding) {
      return [];
    }

    // Calculate similarities
    const scored: SemanticSearchResult[] = [];

    for (const learning of allLearnings) {
      if (learning.id === learningId) continue; // Skip self

      const embedding = allEmbeddings.get(learning.id);
      if (!embedding) continue;

      const similarity = cosineSimilarity(targetEmbedding, embedding);

      if (similarity >= threshold) {
        scored.push({ learning, similarity });
      }
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit);
  }
}
