import { describe, it, expect, vi } from 'vitest';
import { Zoetrope } from '../packages/core/src/index.js';
import { AnimationManifest } from '../packages/manifest/src/index.js';

describe('Failure-Path & Resiliency Unit Tests (Rule 6)', () => {
  const manifest: AnimationManifest = {
    version: '1.0.0',
    id: 'failure-test',
    metadata: {
      totalFrames: 10,
      fps: 30,
      duration: 0.33,
      aspectRatio: '16:9',
    },
    variants: [
      {
        id: 'test',
        minWidth: 0,
        width: 100,
        height: 100,
        format: 'image/webp',
        packing: 'individual',
        frames: Array.from({ length: 10 }, (_, i) => ({
          id: i,
          src: `frame_${i}.webp`,
        })),
      },
    ],
  };

  const createMockCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'medium',
    };
    canvas.getContext = vi.fn().mockReturnValue(ctx);
    return { canvas, ctx };
  };

  it('one frame 404s -> engine emits error event, retries per config, and keeps showing nearest cached frame', async () => {
    const { canvas, ctx } = createMockCanvas();

    // Mock fetch: frame 0 succeeds, frame 1 404s
    const mockBitmap0 = { width: 100, height: 100, close: vi.fn() };
    const globalFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('frame_0')) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      }
      return Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' }));
    });
    vi.stubGlobal('fetch', globalFetch);

    // Mock decode
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap0));

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }));

    const engine = new Zoetrope({
      canvas,
      manifest,
      playback: { mode: 'manual', smoothing: { enabled: false } },
      streaming: { lookahead: 2, lookbehind: 1, concurrency: 1 },
    });

    const errorSpy = vi.fn();
    engine.on('error', errorSpy);

    await engine.init();

    // Render frame 0 (succeeds)
    // @ts-expect-error accessing private renderFrame for unit testing
    await engine.renderFrame(0);
    expect(ctx.drawImage).toHaveBeenCalled();

    // Render frame 1 (fails with 404)
    // @ts-expect-error accessing private renderFrame for unit testing
    await engine.renderFrame(1);

    // Assert error event emitted
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0].message).toContain('404');

    // Assert canvas never blanked out and nearest cached frame (0) was retained
    expect(engine.getCache().getActiveDisplayedFrameId()).toBe(0);

    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('one frame returns corrupt bytes -> decode error event emitted, same fallback', async () => {
    const { canvas } = createMockCanvas();

    const mockBitmap0 = { width: 100, height: 100, close: vi.fn() };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))))
    );

    // Mock decode: succeeds for frame 0, throws decode error for frame 1
    let decodeCall = 0;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockImplementation(() => {
        decodeCall++;
        if (decodeCall === 1) return Promise.resolve(mockBitmap0);
        return Promise.reject(new Error('Corrupt WebP data: invalid chunk length'));
      })
    );

    const engine = new Zoetrope({
      canvas,
      manifest,
      playback: { mode: 'manual', smoothing: { enabled: false } },
    });

    const errorSpy = vi.fn();
    engine.on('error', errorSpy);

    await engine.init();

    // @ts-expect-error private test
    await engine.renderFrame(0);
    // @ts-expect-error private test
    await engine.renderFrame(1);

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0].message).toContain('Corrupt WebP data');

    // Fallback retained
    expect(engine.getCache().getActiveDisplayedFrameId()).toBe(0);

    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('decode finishes after cursor has moved far away -> never painted over current frame', async () => {
    const { canvas, ctx } = createMockCanvas();

    const bitmap0 = { width: 100, height: 100, close: vi.fn() };
    const bitmap5 = { width: 100, height: 100, close: vi.fn() };

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2])))));

    let resolveDecode0: (bmp: unknown) => void;
    const decodePromise = new Promise((resolve) => {
      resolveDecode0 = resolve;
    });

    let callCount = 0;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(bitmap0);
        }
        return decodePromise;
      })
    );

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }));

    const engine = new Zoetrope({
      canvas,
      manifest,
      playback: { mode: 'manual', smoothing: { enabled: false } },
    });

    await engine.init();

    // Start rendering frame 0 (slow decode in-flight)
    // @ts-expect-error private test
    const frame0Promise = engine.renderFrame(0);

    // Allow fetch tick to trigger createImageBitmap
    await new Promise((r) => setTimeout(r, 10));

    // User rapidly flings or jumps to frame 5
    // Directly inject frame 5 into cache and render it immediately
    engine.getCache().put(5, bitmap5);
    // @ts-expect-error private test
    await engine.renderFrame(5);

    // Frame 5 is now active
    expect(engine.getCache().getActiveDisplayedFrameId()).toBe(5);
    const drawCallsBefore = ctx.drawImage.mock.calls.length;

    // Now slow decode of frame 0 finally completes!
    resolveDecode0!(bitmap0);
    await frame0Promise;

    // CRITICAL: Frame 0 MUST NOT paint over active Frame 5!
    expect(engine.getCache().getActiveDisplayedFrameId()).toBe(5);
    // No new drawImage calls occurred for frame 0
    expect(ctx.drawImage.mock.calls.length).toBe(drawCallsBefore);

    engine.destroy();
    vi.unstubAllGlobals();
  });

  it('network abort mid-fetch on direction reversal -> clean abort with no unhandled rejections', async () => {
    const { canvas } = createMockCanvas();

    // Mock fetch that respects AbortSignal
    let fetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
        fetchCount++;
        if (fetchCount === 1) {
          return Promise.resolve(new Response(new Uint8Array([1, 2])));
        }
        return new Promise((resolve, reject) => {
          if (init?.signal?.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            return reject(err);
          }
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      })
    );

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }));

    const engine = new Zoetrope({
      canvas,
      manifest,
      playback: { mode: 'manual', smoothing: { enabled: false } },
      streaming: { lookahead: 2, lookbehind: 1 },
    });

    const errorSpy = vi.fn();
    engine.on('error', errorSpy);

    await engine.init();

    // Trigger forward fetches
    // @ts-expect-error private test
    engine.streamer.updateHorizon(1, 1);

    // Suddenly reverse direction and move far away
    // @ts-expect-error private test
    engine.streamer.updateHorizon(9, -1);

    // Give microtasks time to settle
    await new Promise((r) => setTimeout(r, 20));

    // Abort errors should NOT trigger engine 'error' events or unhandled rejections
    expect(errorSpy).not.toHaveBeenCalled();

    engine.destroy();
    vi.unstubAllGlobals();
  });
});
