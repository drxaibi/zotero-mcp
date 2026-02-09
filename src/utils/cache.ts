/**
 * Simple in-memory cache utility.
 */

interface CacheEntry<T> {
  value: T;
  expires: number;
}

export class Cache<T> {
  private store: Map<string, CacheEntry<T>> = new Map();
  private ttl: number; // milliseconds

  constructor(ttlSeconds = 300) {
    this.ttl = ttlSeconds * 1000;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, {
      value,
      expires: Date.now() + this.ttl,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Remove expired entries.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expires) {
        this.store.delete(key);
      }
    }
  }
}
