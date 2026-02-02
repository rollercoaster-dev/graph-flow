/**
 * Optional API-based embedding providers.
 *
 * These providers use external APIs (OpenAI, OpenRouter) for higher-quality
 * embeddings. They are optional and not loaded by default to maintain the
 * zero-dependency philosophy of the package.
 *
 * Usage:
 * ```typescript
 * import { OpenAIEmbedding, OpenRouterEmbedding } from "claude-knowledge/embeddings/api-providers";
 *
 * // Direct OpenAI
 * const embedder = new OpenAIEmbedding(process.env.OPENAI_API_KEY);
 *
 * // Via OpenRouter (access to multiple providers)
 * const embedder = new OpenRouterEmbedding(process.env.OPENROUTER_API_KEY);
 *
 * const embedding = await embedder.generate("some text");
 * ```
 */

import type { EmbeddingProvider } from "./index";

const logger = {
  info: (msg: string, meta?: unknown) => console.error(`[INFO] ${msg}`, meta || ""),
  warn: (msg: string, meta?: unknown) => console.error(`[WARN] ${msg}`, meta || ""),
  error: (msg: string, meta?: unknown) => console.error(`[ERROR] ${msg}`, meta || ""),
  debug: (msg: string, meta?: unknown) => console.error(`[DEBUG] ${msg}`, meta || ""),
};

/**
 * Usage metrics for tracking API costs.
 */
export interface EmbeddingUsageMetrics {
  /** Total tokens processed */
  totalTokens: number;
  /** Total number of requests made */
  requestCount: number;
  /** Estimated cost in USD (based on text-embedding-3-small pricing) */
  estimatedCostUsd: number;
}

/** Cost per 1M tokens for text-embedding-3-small */
const OPENAI_COST_PER_1M_TOKENS = 0.02;

/** Timeout for embedding API calls (10 seconds) */
const EMBEDDING_FETCH_TIMEOUT_MS = 10_000;

/**
 * OpenAI embedding provider using the embeddings API.
 *
 * Uses the text-embedding-3-small model by default, which provides
 * good quality embeddings at a reasonable cost.
 *
 * @see https://platform.openai.com/docs/guides/embeddings
 */
export class OpenAIEmbedding implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private _dimensions: number;

  /** Cumulative usage metrics across all instances */
  private static usageMetrics: EmbeddingUsageMetrics = {
    totalTokens: 0,
    requestCount: 0,
    estimatedCostUsd: 0,
  };

  /**
   * Get cumulative usage metrics for all OpenAI embedding requests.
   */
  static getUsageMetrics(): EmbeddingUsageMetrics {
    return { ...OpenAIEmbedding.usageMetrics };
  }

  /**
   * Reset usage metrics to zero.
   */
  static resetUsageMetrics(): void {
    OpenAIEmbedding.usageMetrics = {
      totalTokens: 0,
      requestCount: 0,
      estimatedCostUsd: 0,
    };
  }

  /**
   * Create an OpenAI embedding provider.
   *
   * @param apiKey - OpenAI API key
   * @param options - Optional configuration
   */
  constructor(
    apiKey: string,
    options?: {
      /** Model to use (default: "text-embedding-3-small") */
      model?: string;
      /** Output dimensions (default: 256 for consistency with TF-IDF) */
      dimensions?: number;
    },
  ) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }
    this.apiKey = apiKey;
    this.model = options?.model ?? "text-embedding-3-small";
    this._dimensions = options?.dimensions ?? 256;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async generate(text: string): Promise<Float32Array> {
    if (!text || text.trim().length === 0) {
      return new Float32Array(this._dimensions);
    }

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EMBEDDING_FETCH_TIMEOUT_MS,
    );

    try {
      response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: this.model,
          dimensions: this._dimensions,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // Handle timeout separately from other network errors
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `OpenAI API request timed out after ${EMBEDDING_FETCH_TIMEOUT_MS}ms`,
        );
      }
      // Network errors (DNS, connection refused, etc.)
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenAI API network error: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;

      // Provide specific error messages for common error codes
      if (status === 400) {
        throw new Error(
          `OpenAI API bad request: ${errorText}. Check your input parameters.`,
        );
      }
      if (status === 401) {
        throw new Error(
          "OpenAI API authentication failed: Invalid API key. Please check your OPENAI_API_KEY.",
        );
      }
      if (status === 429) {
        throw new Error(
          "OpenAI API rate limit exceeded. Please wait and try again.",
        );
      }
      if (status === 500 || status === 502 || status === 503) {
        throw new Error(
          `OpenAI API service error (${status}). Please try again later.`,
        );
      }

      throw new Error(`OpenAI embeddings API error: ${status} - ${errorText}`);
    }

    let data: {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens: number; total_tokens: number };
    };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new Error(
        "Failed to parse OpenAI API response: Invalid JSON received",
      );
    }

    if (!data.data?.[0]?.embedding) {
      throw new Error("Invalid response from OpenAI embeddings API");
    }

    // Track usage metrics
    if (data.usage) {
      const tokens = data.usage.total_tokens;
      const cost = (tokens / 1_000_000) * OPENAI_COST_PER_1M_TOKENS;

      OpenAIEmbedding.usageMetrics.totalTokens += tokens;
      OpenAIEmbedding.usageMetrics.requestCount += 1;
      OpenAIEmbedding.usageMetrics.estimatedCostUsd += cost;

      logger.debug("OpenAI embedding generated", {
        tokens,
        costUsd: cost.toFixed(6),
        cumulativeTokens: OpenAIEmbedding.usageMetrics.totalTokens,
        cumulativeCostUsd:
          OpenAIEmbedding.usageMetrics.estimatedCostUsd.toFixed(6),
      });
    }

    return new Float32Array(data.data[0].embedding);
  }
}

/** Cost per 1M tokens for OpenRouter (varies by model, using text-embedding-3-small as baseline) */
const OPENROUTER_COST_PER_1M_TOKENS = 0.02;

/**
 * OpenRouter embedding provider using the embeddings API.
 *
 * OpenRouter provides access to multiple embedding models through a unified API.
 * Uses the OpenAI text-embedding-3-small model by default via OpenRouter.
 *
 * @see https://openrouter.ai/docs/api/reference/embeddings
 */
export class OpenRouterEmbedding implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private _dimensions: number;

  /** Cumulative usage metrics across all instances */
  private static usageMetrics: EmbeddingUsageMetrics = {
    totalTokens: 0,
    requestCount: 0,
    estimatedCostUsd: 0,
  };

  /**
   * Get cumulative usage metrics for all OpenRouter embedding requests.
   */
  static getUsageMetrics(): EmbeddingUsageMetrics {
    return { ...OpenRouterEmbedding.usageMetrics };
  }

  /**
   * Reset usage metrics to zero.
   */
  static resetUsageMetrics(): void {
    OpenRouterEmbedding.usageMetrics = {
      totalTokens: 0,
      requestCount: 0,
      estimatedCostUsd: 0,
    };
  }

  /**
   * Create an OpenRouter embedding provider.
   *
   * @param apiKey - OpenRouter API key
   * @param options - Optional configuration
   */
  constructor(
    apiKey: string,
    options?: {
      /** Model to use (default: "openai/text-embedding-3-small") */
      model?: string;
      /** Output dimensions (default: 256 for consistency with TF-IDF) */
      dimensions?: number;
    },
  ) {
    if (!apiKey) {
      throw new Error("OpenRouter API key is required");
    }
    this.apiKey = apiKey;
    this.model = options?.model ?? "openai/text-embedding-3-small";
    this._dimensions = options?.dimensions ?? 256;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async generate(text: string): Promise<Float32Array> {
    if (!text || text.trim().length === 0) {
      return new Float32Array(this._dimensions);
    }

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EMBEDDING_FETCH_TIMEOUT_MS,
    );

    try {
      response = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://rollercoaster.dev",
          "X-Title": "claude-knowledge",
        },
        body: JSON.stringify({
          input: text,
          model: this.model,
          dimensions: this._dimensions,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // Handle timeout separately from other network errors
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `OpenRouter API request timed out after ${EMBEDDING_FETCH_TIMEOUT_MS}ms`,
        );
      }
      // Network errors (DNS, connection refused, etc.)
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenRouter API network error: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;

      if (status === 400) {
        throw new Error(
          `OpenRouter API bad request: ${errorText}. Check your input parameters.`,
        );
      }
      if (status === 401) {
        throw new Error(
          "OpenRouter API authentication failed: Invalid API key. Please check your OPENROUTER_API_KEY.",
        );
      }
      if (status === 402) {
        throw new Error(
          "OpenRouter API payment required: Insufficient credits. Add credits at https://openrouter.ai/credits",
        );
      }
      if (status === 429) {
        throw new Error(
          "OpenRouter API rate limit exceeded. Please wait and try again.",
        );
      }
      if (status === 500 || status === 502 || status === 503) {
        throw new Error(
          `OpenRouter API service error (${status}). Please try again later.`,
        );
      }

      throw new Error(
        `OpenRouter embeddings API error: ${status} - ${errorText}`,
      );
    }

    let data: {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens: number; total_tokens: number };
    };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new Error(
        "Failed to parse OpenRouter API response: Invalid JSON received",
      );
    }

    if (!data.data?.[0]?.embedding) {
      throw new Error("Invalid response from OpenRouter embeddings API");
    }

    // Track usage metrics
    if (data.usage) {
      const tokens = data.usage.total_tokens;
      const cost = (tokens / 1_000_000) * OPENROUTER_COST_PER_1M_TOKENS;

      OpenRouterEmbedding.usageMetrics.totalTokens += tokens;
      OpenRouterEmbedding.usageMetrics.requestCount += 1;
      OpenRouterEmbedding.usageMetrics.estimatedCostUsd += cost;

      logger.debug("OpenRouter embedding generated", {
        model: this.model,
        tokens,
        costUsd: cost.toFixed(6),
        cumulativeTokens: OpenRouterEmbedding.usageMetrics.totalTokens,
        cumulativeCostUsd:
          OpenRouterEmbedding.usageMetrics.estimatedCostUsd.toFixed(6),
      });
    }

    return new Float32Array(data.data[0].embedding);
  }
}

/**
 * Factory function to create an embedding provider by type.
 *
 * @param type - Provider type ('tfidf', 'openai', 'openrouter')
 * @param config - Provider-specific configuration
 * @returns An EmbeddingProvider instance
 *
 * @example
 * ```typescript
 * // Use default TF-IDF (no API key needed)
 * const tfidf = await createEmbeddingProvider('tfidf');
 *
 * // Use OpenAI directly
 * const openai = await createEmbeddingProvider('openai', {
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 *
 * // Use OpenRouter (access to multiple providers)
 * const openrouter = await createEmbeddingProvider('openrouter', {
 *   apiKey: process.env.OPENROUTER_API_KEY,
 * });
 * ```
 */
export async function createEmbeddingProvider(
  type: "tfidf" | "openai" | "openrouter",
  config?: {
    apiKey?: string;
    model?: string;
    dimensions?: number;
  },
): Promise<EmbeddingProvider> {
  switch (type) {
    case "tfidf": {
      // Import TfIdfEmbedding directly - it's in the same package
      // We import here to keep API providers as an optional module
      // that doesn't force users to load TF-IDF if they don't need it
      const { TfIdfEmbedding } = await import("./index");
      return new TfIdfEmbedding({ dimensions: config?.dimensions });
    }
    case "openai": {
      if (!config?.apiKey) {
        throw new Error("OpenAI provider requires an API key");
      }
      return new OpenAIEmbedding(config.apiKey, {
        model: config.model,
        dimensions: config.dimensions,
      });
    }
    case "openrouter": {
      if (!config?.apiKey) {
        throw new Error("OpenRouter provider requires an API key");
      }
      return new OpenRouterEmbedding(config.apiKey, {
        model: config.model,
        dimensions: config.dimensions,
      });
    }
    default:
      throw new Error(`Unknown embedding provider type: ${type}`);
  }
}
