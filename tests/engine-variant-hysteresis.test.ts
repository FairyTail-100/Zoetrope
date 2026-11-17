import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Zoetrope } from '../packages/core/src/index.js';
import {
  AnimationManifest,
  selectVariantWithHysteresis,
} from '../packages/manifest/src/index.js';

describe('Variant Stability & Hysteresis Unit Tests', () => {
  const tinyWebP = Buffer.from(
    'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=',
    'base64'
  );

  const manifest901: AnimationManifest = {
    version: '1.0.0',
    id: 'stability-clip-901',
    metadata: {
      fps: 30,
      totalFrames: 901,
      duration: 30.03,
      aspectRatio: '16:9',
    },
    variants: [
      {
        id: 'desktop',
        width: 1920,
        height: 1080,
        minWidth: 768,
        packing: 'individual',
        format: 'image/webp',
        frameTemplate: '/assets/hero/desktop/frame_%04d.webp',
        frameCount: 901,
      },
      {
        id: 'mobile',
        width: 640,
        height: 360,
        minWidth: 0,
        maxWidth: 767,
        packing: 'individual',
        format: 'image/webp',
        frameTemplate: '/assets/hero/mobile/frame_%04d.webp',
        frameCount: 901,
      },
    ],
  };

  let originalFetch: typeof globalThis.fetch;
  let requestedUrls: string[] = [];

  beforeEach(() => {
    requestedUrls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      requestedUrls.push(urlStr);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => tinyWebP.buffer.slice(tinyWebP.byteOffset, tinyWebP.byteOffset + tinyWebP.byteLength),
        json: async () => manifest901,
      } as unknown as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createMockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const mockCtx = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'medium',
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
      clearRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray([255, 0, 0, 255]) }),
    };
    canvas.getContext = vi.fn().mockReturnValue(mockCtx);
    return canvas;
  }

  it('resize hysteresis: widths 1000 -> 762 -> 770 -> 700 -> 810 yield desktop, desktop, desktop, mobile, desktop', () => {
    const widths = [1000, 762, 770, 700, 810];
    const results: string[] = [];
    let currentVariantId: string | undefined = undefined;

    for (const w of widths) {
      const selected = selectVariantWithHysteresis(manifest901, w, currentVariantId);
      results.push(selected.id);
      currentVariantId = selected.id;
    }

    expect(results).toEqual(['desktop', 'desktop', 'desktop', 'mobile', 'desktop']);
  });

  it('scroll forward 300 frames then reverse 100 at viewport 1920: all requests are /desktop/ and swap count is 0', async () => {
    window.innerWidth = 1920;
    const canvas = createMockCanvas();

    const engine = new Zoetrope({
      canvas,
      manifest: manifest901,
      playback: { mode: 'manual', smoothing: { enabled: false } },
    });

    await engine.init();
    expect(engine.stats().variantId).toBe('desktop');
    expect(engine.stats().variantSwapCount).toBe(0);

    // Scroll forward 300 frames
    for (let f = 0; f <= 300; f += 5) {
      engine.seek(f / 900, true);
      await new Promise((r) => setTimeout(r, 2));
    }

    // Reverse 100 frames (from 300 back to 200)
    for (let f = 300; f >= 200; f -= 5) {
      engine.seek(f / 900, true);
      await new Promise((r) => setTimeout(r, 2));
    }

    const stats = engine.stats();
    expect(stats.variantId).toBe('desktop');
    expect(stats.variantSwapCount).toBe(0);
    expect(['full', 'anchor']).toContain(stats.renderedSource);

    expect(requestedUrls.length).toBeGreaterThan(0);
    const nonDesktopRequests = requestedUrls.filter((u) => !u.includes('/desktop/'));
    expect(nonDesktopRequests).toEqual([]);
    const mobileRequests = requestedUrls.filter((u) => u.includes('/mobile/'));
    expect(mobileRequests).toEqual([]);

    engine.destroy();
  });

  it('fast reversal (high velocity) does not swap variant or request /mobile/', async () => {
    window.innerWidth = 1920;
    const canvas = createMockCanvas();

    const engine = new Zoetrope({
      canvas,
      manifest: manifest901,
      playback: { mode: 'manual', smoothing: { enabled: false } },
    });

    await engine.init();

    // Fast forward jumps
    engine.seek(0.1, true);
    engine.seek(0.2, true);
    engine.seek(0.35, true); // frame ~315
    await new Promise((r) => setTimeout(r, 5));

    // Sudden rapid reversal to frame ~200
    engine.seek(0.30, true);
    engine.seek(0.25, true);
    engine.seek(0.22, true);
    await new Promise((r) => setTimeout(r, 10));

    const stats = engine.stats();
    expect(stats.variantId).toBe('desktop');
    expect(stats.variantSwapCount).toBe(0);

    const mobileRequests = requestedUrls.filter((u) => u.includes('/mobile/'));
    expect(mobileRequests).toEqual([]);

    engine.destroy();
  });

  it('mocked navigator.deviceMemory of 4 retains desktop variant across forward and reverse scrub', async () => {
    window.innerWidth = 1920;
    Object.defineProperty(navigator, 'deviceMemory', {
      value: 4,
      configurable: true,
      writable: true,
    });

    const canvas = createMockCanvas();
    const engine = new Zoetrope({
      canvas,
      manifest: manifest901,
      playback: { mode: 'manual', smoothing: { enabled: false } },
    });

    await engine.init();

    // Forward 300 frames
    for (let f = 0; f <= 300; f += 20) {
      engine.seek(f / 900, true);
    }
    // Reverse 100 frames
    for (let f = 300; f >= 200; f -= 20) {
      engine.seek(f / 900, true);
    }
    await new Promise((r) => setTimeout(r, 10));

    expect(engine.stats().variantId).toBe('desktop');
    expect(engine.stats().variantSwapCount).toBe(0);

    const mobileRequests = requestedUrls.filter((u) => u.includes('/mobile/'));
    expect(mobileRequests).toEqual([]);

    engine.destroy();
  });
});

