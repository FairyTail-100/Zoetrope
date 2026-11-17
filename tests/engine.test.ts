import { describe, it, expect, vi } from 'vitest';
import { Zoetrope } from '../packages/core/src/index.js';
import { AnimationManifest } from '../packages/manifest/src/index.js';

describe('Zoetrope Core Integration', () => {
  const mockManifest: AnimationManifest = {
    version: '1.0.0',
    id: 'engine-integration-test',
    metadata: {
      totalFrames: 60,
      fps: 30,
      duration: 2.0,
      aspectRatio: '16:9',
    },
    variants: [
      {
        id: 'desktop',
        minWidth: 0,
        width: 1280,
        height: 720,
        format: 'image/webp',
        packing: 'individual',
        frames: Array.from({ length: 60 }, (_, i) => ({
          id: i,
          src: `frame_${String(i).padStart(3, '0')}.webp`,
        })),
      },
    ],
    motion: {
      defaultEasing: 'linear',
      lut: [0, 0.25, 0.5, 0.75, 1.0],
    },
  };

  it('initializes cleanly, selects variant, and manages lifecycle', async () => {
    // Create mock canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;

    // Mock 2D context
    const mockCtx = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'medium',
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    canvas.getContext = vi.fn().mockReturnValue(mockCtx);

    const engine = new Zoetrope({
      canvas,
      manifest: mockManifest,
      playback: {
        mode: 'manual',
        smoothing: { enabled: true, tau: 25 },
      },
      cache: {
        maxMemoryBytes: 200 * 1024 * 1024,
      },
    });

    const loadSpy = vi.fn();
    engine.on('load', loadSpy);

    await engine.init();

    expect(loadSpy).toHaveBeenCalledWith(mockManifest);
    expect(engine.getSmoother()).toBeDefined();
    expect(engine.getRenderer()).toBeDefined();
    expect(engine.getCache()).toBeDefined();

    // Test seek
    engine.seek(0.5, true);
    expect(engine.getSmoother().getValue()).toBe(0.5);

    // P3.5: Verify engine.stats() returns structured telemetry summary
    const stats = engine.stats();
    expect(stats.variantId).toBe('desktop');
    expect(typeof stats.hitRatePct).toBe('number');
    expect(typeof stats.availabilityLatencyMs.p95).toBe('number');
    expect(typeof stats.displayedFrameError.mean).toBe('number');

    // Destroy cleanly
    engine.destroy();
  });

  it('P3.2: WorkerPoolDecoder transfers ImageBitmap ownership cleanly and calls close() when orphaned', async () => {
    const { WorkerPoolDecoder } = await import('../packages/decoder/src/worker-decoder.js');

    let capturedOnMessage: ((e: MessageEvent) => void) | null = null;
    const origWorker = globalThis.Worker;
    const mockClose = vi.fn();

    class MockWorker {
      public onmessage: ((e: MessageEvent) => void) | null = null;
      public onerror: ((e: ErrorEvent) => void) | null = null;
      constructor(_url: string) {}
      postMessage(data: { id: number }) {
        capturedOnMessage = this.onmessage;
        // Simulate asynchronous worker reply transferring an ImageBitmap
        setTimeout(() => {
          this.onmessage?.({
            data: {
              id: data.id,
              bitmap: { width: 320, height: 180, close: mockClose },
            },
          } as unknown as MessageEvent);
        }, 5);
      }
      terminate() {}
    }

    (globalThis as any).Worker = MockWorker;
    try {
      const pool = new WorkerPoolDecoder(2);
      const bmp = await pool.decode(new Uint8Array([1, 2, 3]).buffer, 'image/webp');
      expect(bmp.width).toBe(320);
      expect(bmp.height).toBe(180);
      expect(mockClose).not.toHaveBeenCalled();

      // Main-thread caller now owns the transferred ImageBitmap and can close() it
      if ('close' in bmp && typeof bmp.close === 'function') {
        bmp.close();
      }
      expect(mockClose).toHaveBeenCalledTimes(1);

      // If an unsolicited/late worker message arrives for a cancelled/unknown request id, WorkerPoolDecoder closes it immediately
      const orphanClose = vi.fn();
      (capturedOnMessage as any)?.({
        data: {
          id: 9999,
          bitmap: { width: 320, height: 180, close: orphanClose },
        },
      } as unknown as MessageEvent);
      expect(orphanClose).toHaveBeenCalledTimes(1);

      pool.dispose();
    } finally {
      globalThis.Worker = origWorker;
    }
  });
});
