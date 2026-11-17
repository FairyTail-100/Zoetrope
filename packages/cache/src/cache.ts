import { CachedFrame, CacheOptions, CacheStats } from './types.js';

export function estimateMemoryBytes(width: number, height: number): number {
  return width * height * 4; // 4 bytes per RGBA pixel
}

/**
 * Detects device memory budget:
 * 1. navigator.deviceMemory if available (Chromium)
 * 2. Fallback for Safari/Firefox: computes budget based on viewport size and pointer:coarse
 */
export function detectDeviceMemoryBudget(): number {
  if (typeof navigator !== 'undefined') {
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (typeof mem === 'number' && mem > 0) {
      if (mem <= 1) return 64 * 1024 * 1024;   // 64 MB
      if (mem <= 2) return 120 * 1024 * 1024;  // 120 MB
      if (mem <= 4) return 240 * 1024 * 1024;  // 240 MB
      return 450 * 1024 * 1024;                 // 450 MB
    }
  }

  // Fallback for Safari, Firefox, or iOS WebKit where deviceMemory is undefined
  const isCoarse =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  const screenW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1920;
  const screenH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 1080;
  const singleFrameBytes = screenW * screenH * 4;

  if (isCoarse) {
    // Mobile/tablet fallback: conservative budget (~12 frames, capped between 40MB and 90MB)
    return Math.max(40 * 1024 * 1024, Math.min(90 * 1024 * 1024, singleFrameBytes * 12));
  }

  // Desktop fallback without deviceMemory: ~30 frames, capped between 150MB and 350MB
  return Math.max(150 * 1024 * 1024, Math.min(350 * 1024 * 1024, singleFrameBytes * 30));
}

export class DirectionalLRUCache<T extends { width: number; height: number; close?: () => void }> {
  private map: Map<number, CachedFrame<T>> = new Map();
  private maxBytes: number;
  private currentBytes: number = 0;
  private inFlightBytes: number = 0;
  private directionalPenalty: number;

  private currentCursor: number = 0;
  private currentDirection: number = 1; // +1 = forward, -1 = reverse
  private activeDisplayedFrameId: number | null = null;

  private hits: number = 0;
  private misses: number = 0;

  constructor(options?: CacheOptions) {
    this.maxBytes = options?.maxMemoryBytes ?? detectDeviceMemoryBudget();
    this.directionalPenalty = options?.directionalPenalty ?? 2.0;
  }

  public updateCursor(cursor: number, direction: number = 1): void {
    this.currentCursor = cursor;
    this.currentDirection = direction >= 0 ? 1 : -1;
  }

  /**
   * Sets the currently displayed frame on canvas.
   * CRITICAL: The currently displayed frame is NEVER evicted or closed while displayed.
   */
  public setActiveDisplayedFrameId(id: number | null): void {
    this.activeDisplayedFrameId = id;
  }

  public getActiveDisplayedFrameId(): number | null {
    return this.activeDisplayedFrameId;
  }

  public has(id: number): boolean {
    return this.map.has(id);
  }

  public get(id: number): T | null {
    const frame = this.map.get(id);
    if (!frame) {
      this.misses++;
      return null;
    }
    this.hits++;
    frame.lastAccessTime = performance.now();
    return frame.data;
  }

  /**
   * Reserves memory for an in-flight decode operation so concurrent decodes
   * are counted against the budget before they finish.
   */
  public reserveInFlight(bytes: number): void {
    this.inFlightBytes += bytes;
    this.evictUntilWithinBudget();
  }

  public releaseInFlight(bytes: number): void {
    this.inFlightBytes = Math.max(0, this.inFlightBytes - bytes);
  }

  public getInFlightBytes(): number {
    return this.inFlightBytes;
  }

  public put(id: number, data: T, customByteSize?: number): void {
    // If existing frame with same ID, delete it first (calls close() once on the old bitmap)
    if (this.map.has(id)) {
      this.delete(id);
    }

    const byteSize = customByteSize ?? estimateMemoryBytes(data.width, data.height);

    // Evict expendable frames until there is room
    this.evictUntilWithinBudget(byteSize);

    const frame: CachedFrame<T> = {
      id,
      data,
      width: data.width,
      height: data.height,
      byteSize,
      lastAccessTime: performance.now(),
    };

    this.map.set(id, frame);
    this.currentBytes += byteSize;
  }

  private evictUntilWithinBudget(incomingBytes: number = 0): void {
    while (
      this.currentBytes + this.inFlightBytes + incomingBytes > this.maxBytes &&
      this.map.size > 0
    ) {
      const candidateId = this.findWorstEvictionCandidate();
      if (candidateId === null) {
        // No evictable candidate found (e.g. only displayed frame left)
        break;
      }
      this.delete(candidateId);
    }
  }

  public delete(id: number): boolean {
    // Protection rule (a): The active displayed frame cannot be deleted/closed while displayed!
    if (id === this.activeDisplayedFrameId) {
      return false;
    }

    const frame = this.map.get(id);
    if (!frame) return false;

    // Protection rule (b): Call close() exactly once
    if (typeof frame.data.close === 'function') {
      try {
        frame.data.close();
      } catch {
        // Ignored
      }
    }

    this.currentBytes -= frame.byteSize;
    return this.map.delete(id);
  }

  public clear(): void {
    for (const [id, frame] of this.map.entries()) {
      // If currently active displayed, do not close or delete until stage destroyed
      if (id === this.activeDisplayedFrameId) continue;
      if (typeof frame.data.close === 'function') {
        try {
          frame.data.close();
        } catch {
          // Ignored
        }
      }
    }
    const retained = this.activeDisplayedFrameId !== null ? this.map.get(this.activeDisplayedFrameId) : null;
    this.map.clear();
    this.currentBytes = 0;
    this.inFlightBytes = 0;
    if (retained) {
      this.map.set(retained.id, retained);
      this.currentBytes = retained.byteSize;
    }
  }

  public forceDestroyAll(): void {
    for (const frame of this.map.values()) {
      if (typeof frame.data.close === 'function') {
        try {
          frame.data.close();
        } catch {
          // Ignored
        }
      }
    }
    this.map.clear();
    this.currentBytes = 0;
    this.inFlightBytes = 0;
    this.activeDisplayedFrameId = null;
  }

  /**
   * Evaluates each cached frame using the directional penalty formula.
   * Frame with HIGHEST score is the most expendable and evicted first.
   * Active displayed frame is NEVER a candidate!
   */
  private findWorstEvictionCandidate(): number | null {
    let worstId: number | null = null;
    let worstScore = -Infinity;

    for (const [id, frame] of this.map.entries()) {
      // RULE (a): The bitmap for the currently displayed frame is NEVER evicted or closed!
      if (id === this.activeDisplayedFrameId) {
        continue;
      }

      const diff = (id - this.currentCursor) * this.currentDirection;
      const distance = Math.abs(id - this.currentCursor);

      let score: number;
      if (diff >= 0) {
        // In direction of motion
        score = distance;
      } else {
        // Behind motion direction (penalized heavily)
        score = distance * this.directionalPenalty;
      }

      const recencyBonus = (performance.now() - frame.lastAccessTime) * 0.001;
      const totalScore = score + recencyBonus;

      if (totalScore > worstScore) {
        worstScore = totalScore;
        worstId = id;
      }
    }

    return worstId;
  }

  public getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    return {
      totalBytes: this.currentBytes + this.inFlightBytes,
      maxBytes: this.maxBytes,
      frameCount: this.map.size,
      hitCount: this.hits,
      missCount: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 1.0,
    };
  }

  public getCachedIds(): number[] {
    return Array.from(this.map.keys());
  }

  public setMaxMemoryBytes(bytes: number): void {
    this.maxBytes = bytes;
    this.evictUntilWithinBudget();
  }
}
