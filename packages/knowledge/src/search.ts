import type { LearningRecord } from "./storage.ts";

interface TFIDFScore {
  learning: LearningRecord;
  score: number;
}

/**
 * Simple TF-IDF search for learnings
 */
export class LearningSearch {
  private idfCache: Map<string, number> = new Map();

  /**
   * Search learnings using TF-IDF scoring
   */
  search(
    query: string,
    learnings: LearningRecord[],
    limit: number = 10,
  ): LearningRecord[] {
    const queryTerms = this.tokenize(query);

    if (queryTerms.length === 0) {
      return [];
    }

    // Calculate IDF for query terms
    this.buildIDF(learnings);

    // Score each learning
    const scores: TFIDFScore[] = learnings.map((learning) => ({
      learning,
      score: this.calculateScore(queryTerms, learning, learnings.length),
    }));

    // Sort by score and return top results
    return scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.learning);
  }

  /**
   * Build IDF cache for all terms in learnings
   */
  private buildIDF(learnings: LearningRecord[]): void {
    const documentFrequency = new Map<string, number>();

    // Count documents containing each term
    for (const learning of learnings) {
      const terms = new Set(this.tokenize(learning.content));
      for (const term of terms) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
    }

    // Calculate IDF for each term
    const totalDocs = learnings.length;
    for (const [term, docFreq] of documentFrequency.entries()) {
      this.idfCache.set(term, Math.log(totalDocs / docFreq));
    }
  }

  /**
   * Calculate TF-IDF score for a learning
   */
  private calculateScore(
    queryTerms: string[],
    learning: LearningRecord,
    totalDocs: number,
  ): number {
    const docTerms = this.tokenize(learning.content);
    const termFrequency = new Map<string, number>();

    // Calculate term frequency
    for (const term of docTerms) {
      termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
    }

    // Calculate TF-IDF score
    let score = 0;
    for (const queryTerm of queryTerms) {
      const tf = termFrequency.get(queryTerm) || 0;
      const idf = this.idfCache.get(queryTerm) || 0;
      score += tf * idf;
    }

    // Boost score based on type and area match
    if (queryTerms.some((t) => learning.area.toLowerCase().includes(t))) {
      score *= 1.5;
    }

    return score;
  }

  /**
   * Tokenize text into searchable terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2); // Filter out very short terms
  }

  /**
   * Clear IDF cache (call when learnings are updated)
   */
  clearCache(): void {
    this.idfCache.clear();
  }
}
