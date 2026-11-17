import { describe, it, expect, vi } from 'vitest';
import {
  packCEPK,
  unpackCEPK,
  PriorityQueue,
  ChunkStreamer,
} from '../packages/streaming/src/index.js';
import { ResolutionVariant } from '../packages/manifest/src/index.js';

describe('CEPK Binary Container (Packer & Unpacker)', () => {
  it('correctly packs and unpacks multiple frames with exact byte fidelity', () => {
    // Generate synthetic frame buffers
    const f0 = new Uint8Array([10, 20, 30, 40]);
    const f1 = new Uint8Array([50, 60, 70, 80, 90]);
    const f2 = new Uint8Array([100, 110, 120]);

    const packed = packCEPK([
      { frameIndex: 0, data: f0 },
      { frameIndex: 1, data: f1 },
      { frameIndex: 2, data: f2 },
    ]);

    expect(packed.byteLength).toBeGreaterThan(12 + 3 * 12); // Header + Table + Data

    // Verify magic bytes: 'C', 'E', 'P', 'K'
    expect(packed[0]).toBe(0x43);
    expect(packed[1]).toBe(0x45);
    expect(packed[2]).toBe(0x50);
    expect(packed[3]).toBe(0x4b);

    const unpacked = unpackCEPK(packed.buffer as ArrayBuffer);
    expect(unpacked.version).toBe(1);
    expect(unpacked.frames.size).toBe(3);

    expect(Array.from(unpacked.frames.get(0)!)).toEqual(Array.from(f0));
    expect(Array.from(unpacked.frames.get(1)!)).toEqual(Array.from(f1));
    expect(Array.from(unpacked.frames.get(2)!)).toEqual(Array.from(f2));
  });

  it('throws an error on corrupted magic bytes', () => {
    const corruptBuffer = new ArrayBuffer(24);
    new Uint8Array(corruptBuffer).set([0x00, 0x00, 0x00, 0x00]);
    expect(() => unpackCEPK(corruptBuffer)).toThrow(/Invalid CEPK magic bytes/);
  });
});

describe('PriorityQueue', () => {
  it('dequeues requests with highest priority first', () => {
    const pq = new PriorityQueue();

    pq.enqueue({
      frameId: 1,
      priority: 100,
      abortController: new AbortController(),
      resolve: () => {},
      reject: () => {},
    });

    pq.enqueue({
      frameId: 2,
      priority: 500, // Highest
      abortController: new AbortController(),
      resolve: () => {},
      reject: () => {},
    });

    pq.enqueue({
      frameId: 3,
      priority: 250,
      abortController: new AbortController(),
      resolve: () => {},
      reject: () => {},
    });

    expect(pq.dequeue()?.frameId).toBe(2);
    expect(pq.dequeue()?.frameId).toBe(3);
    expect(pq.dequeue()?.frameId).toBe(1);
  });

  it('aborts and purges out-of-horizon requests', () => {
    const pq = new PriorityQueue();
    const abort1 = new AbortController();
    const abort2 = new AbortController();

    pq.enqueue({
      frameId: 10,
      priority: 100,
      abortController: abort1,
      resolve: () => {},
      reject: () => {},
    });

    pq.enqueue({
      frameId: 50,
      priority: 10,
      abortController: abort2,
      resolve: () => {},
      reject: () => {},
    });

    // Purge if frameId > 20
    pq.purgeBeyond((id) => id > 20);

    expect(pq.size()).toBe(1);
    expect(abort2.signal.aborted).toBe(true);
    expect(abort1.signal.aborted).toBe(false);
  });
});

describe('ChunkStreamer BlobCache Residency & Zero Refetch', () => {
  const mockVariant: ResolutionVariant = {
    id: 'desktop',
    width: 1920,
    height: 1080,
    format: 'image/webp',
    packing: 'individual',
    frameCount: 10,
    frameTemplate: '/frames/frame_%04d.webp',
  };

  it('does not trigger a network fetch if frame is already resident in blobCache', async () => {
    let networkFetches = 0;
    const originalFetch = globalThis.fetch;
    const fakeBuffer = new Uint8Array([1, 2, 3, 4]).buffer;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      networkFetches++;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => fakeBuffer,
      } as unknown as Response;
    });

    try {
      const streamer = new ChunkStreamer(mockVariant, 'http://localhost:3000');
      // Pre-populate frame 5 into blob cache
      const cachedBuf = new Uint8Array([9, 9, 9]).buffer;
      streamer.getBlobCache().put(5, cachedBuf);

      const res = await streamer.fetchFrame(5);
      expect(res).toBe(cachedBuf);
      expect(networkFetches).toBe(0);
      streamer.destroy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('resolves from blobCache without network fetch if frame becomes resident while waiting in queue', async () => {
    let networkFetches = 0;
    const originalFetch = globalThis.fetch;
    const fakeBuffer = new Uint8Array([1, 2, 3, 4]).buffer;

    let resolveActiveFetch: (() => void) | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      networkFetches++;
      await new Promise<void>((r) => {
        resolveActiveFetch = r;
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => fakeBuffer,
      } as unknown as Response;
    });

    try {
      const streamer = new ChunkStreamer(mockVariant, 'http://localhost:3000', { concurrency: 1 });

      // Start fetch for frame 1 (occupies concurrency slot 1)
      const p1 = streamer.fetchFrame(1);

      // Enqueue fetch for frame 2 (will wait in priority queue)
      const p2 = streamer.fetchFrame(2);

      // While frame 2 is waiting in queue, populate it into blob cache
      const cachedBuf2 = new Uint8Array([7, 7, 7]).buffer;
      streamer.getBlobCache().put(2, cachedBuf2);

      // Now finish frame 1 fetch, freeing the concurrency slot to process queue
      resolveActiveFetch!();
      await p1;
      const res2 = await p2;

      expect(res2).toBe(cachedBuf2);
      expect(networkFetches).toBe(1); // Only frame 1 was fetched from network, frame 2 resolved from blob cache
      streamer.destroy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
