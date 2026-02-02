/**
 * Vector similarity utilities for semantic search.
 *
 * These functions are pure (no side effects) and operate on Float32Array
 * embeddings for efficient numerical computation.
 */

/**
 * Calculate the dot product of two vectors.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns The dot product (sum of element-wise products)
 * @throws Error if vectors have different dimensions
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Dimension mismatch: vector a has ${a.length} dimensions, vector b has ${b.length}`,
    );
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Calculate the L2 (Euclidean) magnitude of a vector.
 *
 * @param vec - The vector
 * @returns The magnitude (square root of sum of squares)
 */
export function magnitude(vec: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSquares += vec[i] * vec[i];
  }
  return Math.sqrt(sumSquares);
}

/**
 * L2 normalize a vector, returning a new unit vector.
 *
 * A unit vector has magnitude 1.0 and points in the same direction
 * as the original vector. This is useful for cosine similarity
 * since cos(a, b) = a · b when both vectors are normalized.
 *
 * @param vec - The vector to normalize
 * @returns A new Float32Array with magnitude 1.0
 */
export function l2Normalize(vec: Float32Array): Float32Array {
  const normalized = new Float32Array(vec.length);
  const mag = magnitude(vec);

  if (mag === 0) {
    // Return zero vector if input is zero vector
    return normalized;
  }

  for (let i = 0; i < vec.length; i++) {
    normalized[i] = vec[i] / mag;
  }
  return normalized;
}

/**
 * Calculate cosine similarity between two vectors.
 *
 * Cosine similarity measures the angle between two vectors:
 * - 1.0 = identical direction (parallel)
 * - 0.0 = orthogonal (perpendicular)
 * - -1.0 = opposite direction (anti-parallel)
 *
 * Formula: cos(a, b) = (a · b) / (||a|| × ||b||)
 *
 * For normalized vectors, this simplifies to just the dot product.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity score in range [-1.0, 1.0]
 * @throws Error if vectors have different dimensions
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Dimension mismatch: vector a has ${a.length} dimensions, vector b has ${b.length}`,
    );
  }

  const magA = magnitude(a);
  const magB = magnitude(b);

  // Handle zero vectors - return 0.0 similarity
  if (magA === 0 || magB === 0) {
    return 0.0;
  }

  const dot = dotProduct(a, b);
  return dot / (magA * magB);
}

/**
 * Result of a similarity comparison.
 */
export interface SimilarityResult {
  /** The similarity score between -1.0 and 1.0 */
  similarity: number;
  /** The ID or index of the compared item */
  id: string | number;
}

/**
 * Find the most similar vectors to a query vector.
 *
 * @param query - The query vector to compare against
 * @param candidates - Array of [id, vector] pairs to search
 * @param options - Search options
 * @returns Array of results sorted by similarity (highest first)
 */
export function findMostSimilar(
  query: Float32Array,
  candidates: Array<[string | number, Float32Array]>,
  options: {
    /** Maximum number of results to return (default: 10) */
    limit?: number;
    /** Minimum similarity threshold (default: 0.0) */
    threshold?: number;
  } = {},
): SimilarityResult[] {
  const { limit = 10, threshold = 0.0 } = options;

  const results: SimilarityResult[] = [];

  for (const [id, vector] of candidates) {
    const similarity = cosineSimilarity(query, vector);

    if (similarity >= threshold) {
      results.push({ id, similarity });
    }
  }

  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);

  // Return top N
  return results.slice(0, limit);
}
