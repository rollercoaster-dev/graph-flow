import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bufferToFloatArray, floatArrayToBuffer } from "./embeddings";

/**
 * Storage for embeddings alongside JSONL learnings
 * Embeddings are stored in binary files: .claude/embeddings/{area}.bin
 */
export class EmbeddingStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private normalizeArea(area: string): string {
    const trimmed = area.trim();
    const isSafe =
      trimmed.length > 0 &&
      !trimmed.includes("..") &&
      !trimmed.includes("/") &&
      !trimmed.includes("\\");
    if (!isSafe) {
      throw new Error(`Invalid area: ${area}`);
    }
    return trimmed;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Store embedding for a learning
   * Format: [id_length(4 bytes)][id][embedding_length(4 bytes)][embedding]
   */
  async store(
    area: string,
    learningId: string,
    embedding: Float32Array,
  ): Promise<void> {
    const safeArea = this.normalizeArea(area);
    const filepath = join(this.baseDir, `${safeArea}.bin`);

    // Convert embedding to buffer
    const embeddingBuffer = floatArrayToBuffer(embedding);

    // Create record: ID length + ID + embedding length + embedding
    const idBuffer = Buffer.from(learningId, "utf-8");
    const record = Buffer.concat([
      Buffer.from(new Uint32Array([idBuffer.length]).buffer),
      idBuffer,
      Buffer.from(new Uint32Array([embeddingBuffer.length]).buffer),
      embeddingBuffer,
    ]);

    // Append to file
    const existing = existsSync(filepath)
      ? await Bun.file(filepath).arrayBuffer()
      : new ArrayBuffer(0);
    await Bun.write(filepath, Buffer.concat([Buffer.from(existing), record]));
  }

  /**
   * Read all embeddings for an area
   */
  async readAll(area: string): Promise<Map<string, Float32Array>> {
    const safeArea = this.normalizeArea(area);
    const filepath = join(this.baseDir, `${safeArea}.bin`);
    const embeddings = new Map<string, Float32Array>();

    if (!existsSync(filepath)) {
      return embeddings;
    }

    const buffer = Buffer.from(await Bun.file(filepath).arrayBuffer());
    let offset = 0;

    while (offset < buffer.length) {
      // Read ID length
      const idLength = buffer.readUInt32LE(offset);
      offset += 4;

      // Read ID
      const id = buffer.toString("utf-8", offset, offset + idLength);
      offset += idLength;

      // Read embedding length
      const embeddingLength = buffer.readUInt32LE(offset);
      offset += 4;

      // Read embedding
      const embeddingBuffer = buffer.subarray(offset, offset + embeddingLength);
      const embedding = bufferToFloatArray(embeddingBuffer);
      offset += embeddingLength;

      embeddings.set(id, embedding);
    }

    return embeddings;
  }

  /**
   * Check if embeddings exist for an area
   */
  exists(area: string): boolean {
    const safeArea = this.normalizeArea(area);
    return existsSync(join(this.baseDir, `${safeArea}.bin`));
  }
}
