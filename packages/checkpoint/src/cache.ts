/**
 * LRU (Least Recently Used) cache for in-memory workflow storage
 * Limits memory usage while keeping hot workflows accessible
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get value from cache, marks as recently used
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Set value in cache, evicts oldest if at capacity
   */
  set(key: K, value: V): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  /**
   * Delete from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Check if key exists
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get all values
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }
}
