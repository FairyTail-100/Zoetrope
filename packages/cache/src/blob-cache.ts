import { BlobCacheOptions, BlobCacheStats } from './types.js';

export function detectBlobMemoryBudget(options?: BlobCacheOptions): number {
  if (options?.maxBytes !== undefined) {
    return options.maxBytes;
  }
  if (options?.blobBudgetMb !== undefined) {
    return options.blobBudgetMb * 1024 * 1024;
  }
  const isCoarse =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  if (isCoarse) {
    return 48 * 1024 * 1024; // 48 MB mobile default
  }
  return 128 * 1024 * 1024; // 128 MB desktop default
}

export class BlobCache {
  private map: Map<number, ArrayBuffer> = new Map();
  private maxBytes: number;
  private currentBytes: number = 0;
  private hits: number = 0;
  private misses: number = 0;
  private recentlyEvicted: Set<number> = new Set();
  private maxRecentlyEvicted: number = 64;

  constructor(options?: BlobCacheOptions) {
    this.maxBytes = detectBlobMemoryBudget(options);
  }

  public has(id: number): boolean {
    return this.map.has(id);
  }

  public get(id: number): ArrayBuffer | undefined {
    const buf = this.map.get(id);
    if (!buf) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    // LRU refresh: re-insert at end of Map iteration order
    this.map.delete(id);
    this.map.set(id, buf);
    return buf;
  }

  public put(id: number, buffer: ArrayBuffer): void {
    if (this.map.has(id)) {
      const old = this.map.get(id)!;
      this.currentBytes -= old.byteLength;
      this.map.delete(id);
    }
    this.recentlyEvicted.delete(id);

    // Evict oldest LRU entries (at start of Map) until incoming fits
    const incomingBytes = buffer.byteLength;
    while (this.currentBytes + incomingBytes > this.maxBytes && this.map.size > 0) {
      const oldestId = this.map.keys().next().value;
      if (oldestId === undefined) break;
      this.evict(oldestId);
    }

    this.map.set(id, buffer);
    this.currentBytes += incomingBytes;
  }

  private evict(id: number): void {
    const buf = this.map.get(id);
    if (buf) {
      this.currentBytes -= buf.byteLength;
      this.map.delete(id);
      this.recentlyEvicted.add(id);
      if (this.recentlyEvicted.size > this.maxRecentlyEvicted) {
        const first = this.recentlyEvicted.values().next().value;
        if (first !== undefined) this.recentlyEvicted.delete(first);
      }
    }
  }

  public isRecentlyEvicted(id: number): boolean {
    return this.recentlyEvicted.has(id);
  }

  public clearRecentlyEvicted(): void {
    this.recentlyEvicted.clear();
  }

  public delete(id: number): boolean {
    const buf = this.map.get(id);
    if (!buf) return false;
    this.currentBytes -= buf.byteLength;
    return this.map.delete(id);
  }

  public clear(): void {
    this.map.clear();
    this.currentBytes = 0;
    this.recentlyEvicted.clear();
  }

  public destroy(): void {
    this.clear();
    this.hits = 0;
    this.misses = 0;
  }

  public getStats(): BlobCacheStats {
    return {
      totalBytes: this.currentBytes,
      maxBytes: this.maxBytes,
      count: this.map.size,
      hitCount: this.hits,
      missCount: this.misses,
    };
  }

  public getCachedIds(): number[] {
    return Array.from(this.map.keys());
  }

  public setMaxBytes(bytes: number): void {
    this.maxBytes = bytes;
    while (this.currentBytes > this.maxBytes && this.map.size > 0) {
      const oldestId = this.map.keys().next().value;
      if (oldestId === undefined) break;
      this.evict(oldestId);
    }
  }
}

