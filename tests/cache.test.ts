import { describe, it, expect, vi } from 'vitest';
import {
  DirectionalLRUCache,
  BlobCache,
  estimateMemoryBytes,
  detectDeviceMemoryBudget,
} from '../packages/cache/src/index.js';

describe('DirectionalLRUCache Requirements (Rules 7a-d & Auto-Budget 10)', () => {
  interface MockBitmap {
    width: number;
    height: number;
    close: () => void;
  }

  const createMockBitmap = (w = 100, h = 100): MockBitmap => ({
    width: w,
    height: h,
    close: vi.fn(),
  });

  it('7c: enforces budget in bytes using decoded width*height*4', () => {
    // 1920 * 1080 * 4 = 8,294,400 bytes
    expect(estimateMemoryBytes(1920, 1080)).toBe(8294400);

    const b1 = createMockBitmap(1920, 1080);
    const b2 = createMockBitmap(1920, 1080);

    // Budget fits exactly 1 frame
    const cache = new DirectionalLRUCache<MockBitmap>({
      maxMemoryBytes: 10 * 1024 * 1024,
    });

    cache.put(1, b1);
    expect(cache.getStats().totalBytes).toBe(8294400);

    // Adding second frame evicts the first
    cache.put(2, b2);
    expect(cache.has(1)).toBe(false);
    expect(cache.has(2)).toBe(true);
    expect(cache.getStats().totalBytes).toBe(8294400);
  });

  it('7a: the bitmap for the currently displayed frame is NEVER evicted or closed while displayed', () => {
    // Budget fits 2 frames (80,000 bytes)
    const cache = new DirectionalLRUCache<MockBitmap>({
      maxMemoryBytes: 80000,
      directionalPenalty: 2.0,
    });

    const b1 = createMockBitmap(100, 100); // 40,000 bytes
    const b2 = createMockBitmap(100, 100); // 40,000 bytes
    const b3 = createMockBitmap(100, 100); // 40,000 bytes

    cache.updateCursor(10, 1);
    cache.put(5, b1);  // Behind cursor
    cache.put(10, b2); // Currently displayed on canvas!

    // Mark frame 5 as active displayed frame (even if behind cursor)
    cache.setActiveDisplayedFrameId(5);

    // Now insert frame 15 (b3), causing eviction
    // Normally frame 5 (behind) would be evicted first due to 2.0x penalty.
    // But frame 5 is currently displayed, so frame 10 must be evicted instead!
    cache.put(15, b3);

    expect(cache.has(5)).toBe(true); // Retained because it's actively displayed!
    expect(cache.has(10)).toBe(false); // Evicted!
    expect(cache.has(15)).toBe(true);
    expect(b1.close).not.toHaveBeenCalled();
    expect(b2.close).toHaveBeenCalledTimes(1);
  });

  it('7b: every evicted or replaced bitmap has close() called exactly once', () => {
    const cache = new DirectionalLRUCache<MockBitmap>({
      maxMemoryBytes: 50000, // Fits 1 frame
    });

    const b1 = createMockBitmap();
    const b2 = createMockBitmap();

    cache.put(1, b1);
    expect(b1.close).not.toHaveBeenCalled();

    // Eviction calls close() once
    cache.put(2, b2);
    expect(b1.close).toHaveBeenCalledTimes(1);
    expect(b2.close).not.toHaveBeenCalled();

    // Replacing frame 2 with new bitmap calls close() on previous bitmap
    const b2_new = createMockBitmap();
    cache.put(2, b2_new);
    expect(b2.close).toHaveBeenCalledTimes(1);
    expect(b2_new.close).not.toHaveBeenCalled();
  });

  it('7d: in-flight decodes are counted against the memory budget', () => {
    // Budget fits 2 frames (80,000 bytes)
    const cache = new DirectionalLRUCache<MockBitmap>({
      maxMemoryBytes: 80000,
    });

    const b1 = createMockBitmap(); // 40,000 bytes
    cache.put(1, b1);
    expect(cache.has(1)).toBe(true);

    // In-flight decode begins for another 50,000 bytes
    cache.reserveInFlight(50000);

    // Total memory now 40,000 + 50,000 = 90,000 > 80,000
    // Frame 1 must be evicted to honor in-flight reservation!
    expect(cache.has(1)).toBe(false);
    expect(cache.getStats().totalBytes).toBe(50000); // In-flight accounted for

    cache.releaseInFlight(50000);
    expect(cache.getStats().totalBytes).toBe(0);
  });

  it('10: auto memory budget detects deviceMemory and falls back when absent', () => {
    // When navigator.deviceMemory is set (e.g. 8GB)
    Object.defineProperty(globalThis.navigator, 'deviceMemory', {
      value: 8,
      configurable: true,
    });
    expect(detectDeviceMemoryBudget()).toBe(450 * 1024 * 1024);

    // When navigator.deviceMemory is absent (Safari / Firefox)
    Object.defineProperty(globalThis.navigator, 'deviceMemory', {
      value: undefined,
      configurable: true,
    });

    // Desktop pointer (fine): conservative fallback
    const desktopBudget = detectDeviceMemoryBudget();
    expect(desktopBudget).toBeGreaterThanOrEqual(150 * 1024 * 1024);
    expect(desktopBudget).toBeLessThanOrEqual(350 * 1024 * 1024);
  });

  describe('BlobCache (Two-Tier Compressed Blob Storage)', () => {
    it('stores compressed ArrayBuffers within byte budget and evicts LRU', () => {
      // 100 KB budget
      const cache = new BlobCache({ maxBytes: 100 * 1024 });
      const buf1 = new ArrayBuffer(40 * 1024);
      const buf2 = new ArrayBuffer(40 * 1024);
      const buf3 = new ArrayBuffer(40 * 1024);

      cache.put(1, buf1);
      cache.put(2, buf2);
      expect(cache.has(1)).toBe(true);
      expect(cache.has(2)).toBe(true);
      expect(cache.getStats().totalBytes).toBe(80 * 1024);

      // Access 1 so 2 becomes LRU
      cache.get(1);

      // Adding 3 (40KB) -> 80KB + 40KB = 120KB > 100KB -> evicts 2
      cache.put(3, buf3);
      expect(cache.has(2)).toBe(false);
      expect(cache.has(1)).toBe(true);
      expect(cache.has(3)).toBe(true);
      expect(cache.isRecentlyEvicted(2)).toBe(true);
    });

    it('honors custom blobBudgetMb option', () => {
      const cache = new BlobCache({ blobBudgetMb: 64 });
      expect(cache.getStats().maxBytes).toBe(64 * 1024 * 1024);
    });

    it('cleans up completely on destroy()', () => {
      const cache = new BlobCache({ maxBytes: 10000 });
      cache.put(1, new ArrayBuffer(100));
      expect(cache.getStats().count).toBe(1);
      cache.destroy();
      expect(cache.getStats().count).toBe(0);
      expect(cache.getStats().totalBytes).toBe(0);
    });
  });
});
