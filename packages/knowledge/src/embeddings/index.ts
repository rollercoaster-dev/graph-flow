/**
 * Embedding providers for semantic search in the knowledge graph.
 *
 * This module provides a pluggable embedding interface with a default TF-IDF
 * implementation that requires zero external dependencies.
 *
 * When OPENAI_API_KEY is set, neural embeddings are used automatically for
 * better semantic matching. Falls back to TF-IDF when no API key is available.
 */

// Buffer import needed for ESLint - it's also global in Bun runtime
import { Buffer } from "buffer";
// Simple logger replacement
const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[INFO] ${msg}`, meta || ""),
  warn: (msg: string, meta?: unknown) => console.warn(`[WARN] ${msg}`, meta || ""),
  debug: (msg: string, meta?: unknown) => console.debug(`[DEBUG] ${msg}`, meta || ""),
};

/**
 * Supported embedding provider types.
 */
export type EmbeddingProviderType = "tfidf" | "openai" | "openrouter";

/**
 * Configuration for embedding provider selection.
 */
export interface EmbeddingConfig {
  /** Provider type to use ('tfidf' | 'openai' | 'openrouter'). Auto-detected if not specified. */
  providerType?: EmbeddingProviderType;
  /** OpenAI API key (required for 'openai' provider) */
  apiKey?: string;
  /** Output dimensions (default: 256) */
  dimensions?: number;
}

/**
 * Interface for embedding providers.
 * Implementations generate fixed-dimension vector representations of text.
 */
export interface EmbeddingProvider {
  /**
   * Generate an embedding vector for the given text.
   * @param text - The text to embed
   * @returns A Float32Array representing the embedding vector
   */
  generate(text: string): Promise<Float32Array>;

  /**
   * Get the dimension of embeddings produced by this provider.
   */
  readonly dimensions: number;
}

/**
 * Configuration for TF-IDF embedding provider.
 */
export interface TfIdfConfig {
  /** Number of dimensions for the embedding vector (default: 256) */
  dimensions?: number;
}

/** Default number of dimensions for TF-IDF embeddings */
const DEFAULT_DIMENSIONS = 256;

/**
 * Simple hash function for the hashing trick.
 * Maps words to bucket indices deterministically.
 */
function hashWord(word: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < word.length; i++) {
    // Use a prime multiplier for better distribution
    hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
  }
  return hash % buckets;
}

/**
 * Tokenize text into lowercase words.
 * Removes punctuation and splits on whitespace.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
    .split(/\s+/) // Split on whitespace
    .filter((token) => token.length > 0); // Remove empty tokens
}

/**
 * Calculate term frequency for tokens.
 * Returns a map of token -> frequency.
 */
function calculateTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  // Normalize by document length
  const docLength = tokens.length;
  if (docLength > 0) {
    for (const [token, count] of tf) {
      tf.set(token, count / docLength);
    }
  }
  return tf;
}

/**
 * L2 normalize a vector in place.
 * Converts vector to unit length for cosine similarity.
 */
function l2NormalizeInPlace(vec: Float32Array): void {
  let sumSquares = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSquares += vec[i] * vec[i];
  }
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= magnitude;
    }
  }
}

/**
 * TF-IDF embedding provider with hashing trick.
 *
 * This implementation uses the hashing trick to map words to fixed-dimension
 * vectors without maintaining a vocabulary. This allows for:
 * - Fixed memory usage regardless of vocabulary size
 * - No need to rebuild index when vocabulary changes
 * - Deterministic embeddings (same input = same output)
 *
 * Trade-off: Some hash collisions may occur, but with 256 dimensions
 * this is acceptable for typical knowledge graph sizes (<10k documents).
 */
export class TfIdfEmbedding implements EmbeddingProvider {
  readonly dimensions: number;

  // Corpus statistics for IDF calculation
  private documentCount = 0;
  private documentFrequency = new Map<number, number>(); // bucket -> doc count

  constructor(config?: TfIdfConfig) {
    this.dimensions = config?.dimensions ?? DEFAULT_DIMENSIONS;
  }

  /**
   * Update corpus statistics with a new document.
   * Called internally when generating embeddings.
   */
  private updateCorpusStats(tokens: string[]): void {
    this.documentCount++;

    // Track which buckets this document contributes to
    const seenBuckets = new Set<number>();
    for (const token of tokens) {
      const bucket = hashWord(token, this.dimensions);
      seenBuckets.add(bucket);
    }

    // Increment document frequency for each bucket
    for (const bucket of seenBuckets) {
      this.documentFrequency.set(
        bucket,
        (this.documentFrequency.get(bucket) || 0) + 1,
      );
    }
  }

  /**
   * Calculate IDF for a bucket.
   * IDF = log(N / (df + 1)) where N = total docs, df = docs containing term
   */
  private calculateIdf(bucket: number): number {
    const df = this.documentFrequency.get(bucket) || 0;
    // Add 1 to prevent division by zero and smooth rare terms
    return Math.log((this.documentCount + 1) / (df + 1)) + 1;
  }

  /**
   * Generate a TF-IDF embedding for the given text.
   *
   * The embedding is a fixed-dimension vector where each dimension
   * corresponds to a hash bucket. The value is TF * IDF for terms
   * that hash to that bucket.
   *
   * @param text - The text to embed
   * @returns L2-normalized Float32Array of dimension `this.dimensions`
   */
  async generate(text: string): Promise<Float32Array> {
    const tokens = tokenize(text);
    const embedding = new Float32Array(this.dimensions);

    if (tokens.length === 0) {
      return embedding; // Return zero vector for empty text
    }

    // Update corpus statistics
    this.updateCorpusStats(tokens);

    // Calculate TF for this document
    const tf = calculateTf(tokens);

    // Build TF-IDF vector using hashing trick
    for (const [token, tfValue] of tf) {
      const bucket = hashWord(token, this.dimensions);
      const idf = this.calculateIdf(bucket);
      // Accumulate in case of hash collisions
      embedding[bucket] += tfValue * idf;
    }

    // L2 normalize for cosine similarity
    l2NormalizeInPlace(embedding);

    return embedding;
  }

  /**
   * Get current corpus size (number of documents processed).
   * Useful for debugging and testing.
   */
  get corpusSize(): number {
    return this.documentCount;
  }

  /**
   * Reset corpus statistics.
   * Use when starting fresh or for testing.
   */
  reset(): void {
    this.documentCount = 0;
    this.documentFrequency.clear();
  }
}

/**
 * Convert a Float32Array to a Buffer for database storage.
 */
export function floatArrayToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * Convert a Buffer back to a Float32Array.
 */
export function bufferToFloatArray(buf: Buffer): Float32Array {
  // Create a copy to avoid alignment issues
  const arrayBuffer = new ArrayBuffer(buf.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buf.length; i++) {
    view[i] = buf[i];
  }
  return new Float32Array(arrayBuffer);
}

// Default singleton instance for convenience
let defaultEmbedder: EmbeddingProvider | null = null;
let currentProviderType: EmbeddingProviderType | null = null;
let providerLoggedOnce = false;

/**
 * Detect the best available embedding provider based on environment.
 *
 * Priority order:
 * 1. OPENROUTER_API_KEY - OpenRouter (unified access to multiple models)
 * 2. OPENAI_API_KEY - Direct OpenAI
 * 3. TF-IDF - Local fallback (zero dependencies)
 *
 * @returns The provider type to use and any auto-detected configuration
 */
function detectProvider(): { type: EmbeddingProviderType; apiKey?: string } {
  // Check OpenRouter first (preferred - unified API)
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey && openrouterKey.trim().length > 0) {
    return { type: "openrouter", apiKey: openrouterKey };
  }

  // Check OpenAI direct
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && openaiKey.trim().length > 0) {
    return { type: "openai", apiKey: openaiKey };
  }

  // Fallback to TF-IDF
  return { type: "tfidf" };
}

/**
 * Get the default embedding provider.
 *
 * Provider selection (auto-detection priority):
 * 1. If config.providerType is specified, use that provider
 * 2. If OPENROUTER_API_KEY env var is set, use OpenRouter (unified API)
 * 3. If OPENAI_API_KEY env var is set, use OpenAI neural embeddings
 * 4. Otherwise, fall back to TF-IDF (zero dependencies)
 *
 * Uses a singleton to maintain state across calls. The singleton is
 * re-created if the provider type changes.
 *
 * @param config - Optional configuration to override auto-detection
 * @returns An embedding provider instance
 */
export async function getDefaultEmbedder(
  config?: EmbeddingConfig,
): Promise<EmbeddingProvider> {
  // Determine provider type
  const detected = detectProvider();
  const requestedType = config?.providerType ?? detected.type;
  const apiKey = config?.apiKey ?? detected.apiKey;
  const dimensions = config?.dimensions ?? 256;

  // Check if we need to create a new provider
  const needsNewProvider =
    !defaultEmbedder || currentProviderType !== requestedType;

  if (needsNewProvider) {
    if (requestedType === "openrouter") {
      if (!apiKey) {
        logger.warn(
          "OpenRouter provider requested but no API key available, falling back to TF-IDF",
        );
        defaultEmbedder = new TfIdfEmbedding({ dimensions });
        currentProviderType = "tfidf";
      } else {
        // Dynamically import to avoid loading when not needed
        const { OpenRouterEmbedding } = await import("./api-providers");
        defaultEmbedder = new OpenRouterEmbedding(apiKey, { dimensions });
        currentProviderType = "openrouter";
      }
    } else if (requestedType === "openai") {
      if (!apiKey) {
        logger.warn(
          "OpenAI provider requested but no API key available, falling back to TF-IDF",
        );
        defaultEmbedder = new TfIdfEmbedding({ dimensions });
        currentProviderType = "tfidf";
      } else {
        // Dynamically import to avoid loading when not needed
        const { OpenAIEmbedding } = await import("./api-providers");
        defaultEmbedder = new OpenAIEmbedding(apiKey, { dimensions });
        currentProviderType = "openai";
      }
    } else {
      defaultEmbedder = new TfIdfEmbedding({ dimensions });
      currentProviderType = "tfidf";
    }

    // Log provider selection once
    if (!providerLoggedOnce) {
      logger.info(`Embedding provider initialized: ${currentProviderType}`, {
        dimensions,
        autoDetected: !config?.providerType,
      });
      providerLoggedOnce = true;
    }
  }

  // At this point defaultEmbedder is guaranteed to be set
  return defaultEmbedder!;
}

/**
 * Get the default embedding provider synchronously.
 *
 * This is a synchronous wrapper that only works if the provider has already
 * been initialized, or if using TF-IDF (which doesn't require async import).
 *
 * For first-time initialization with OpenAI/OpenRouter provider, use getDefaultEmbedder() instead.
 *
 * @returns An embedding provider instance
 * @throws If OpenAI/OpenRouter provider is needed but not yet initialized
 */
export function getDefaultEmbedderSync(): EmbeddingProvider {
  if (defaultEmbedder) {
    return defaultEmbedder;
  }

  // Check if we should use an API provider
  const detected = detectProvider();
  if (detected.type === "openai" || detected.type === "openrouter") {
    throw new Error(
      `${detected.type} provider requires async initialization. Use getDefaultEmbedder() instead.`,
    );
  }

  // Safe to create TF-IDF synchronously
  defaultEmbedder = new TfIdfEmbedding();
  currentProviderType = "tfidf";

  if (!providerLoggedOnce) {
    logger.info("Embedding provider initialized: tfidf", {
      dimensions: 256,
      autoDetected: true,
    });
    providerLoggedOnce = true;
  }

  return defaultEmbedder;
}

/**
 * Set the default embedding provider explicitly.
 *
 * Use this to override auto-detection or inject a custom provider.
 *
 * @param provider - The provider to use as default
 * @param type - The provider type (for logging and tracking)
 */
export function setDefaultProvider(
  provider: EmbeddingProvider,
  type: EmbeddingProviderType,
): void {
  defaultEmbedder = provider;
  currentProviderType = type;
  logger.info(`Embedding provider set explicitly: ${type}`, {
    dimensions: provider.dimensions,
  });
}

/**
 * Get the current provider type.
 *
 * @returns The current provider type, or null if not yet initialized
 */
export function getCurrentProviderType(): EmbeddingProviderType | null {
  return currentProviderType;
}

/**
 * Reset the default embedder.
 * Useful for testing to start with fresh state.
 */
export function resetDefaultEmbedder(): void {
  defaultEmbedder = null;
  currentProviderType = null;
  providerLoggedOnce = false;
}
