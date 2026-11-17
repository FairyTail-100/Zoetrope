import { describe, it, expect, vi } from 'vitest';
import { Zoetrope } from '../packages/core/src/engine.js';
import { AnimationManifest } from '../packages/manifest/src/types.js';

describe('Production Readiness: Lifecycle, Destroy, and Error Handling', () => {
  const minimalManifest: AnimationManifest = {
    $schema: 'https://raw.githubusercontent.com/FairyTail-100/Zoetrope/main/schema/v1.json',
    version: '1.0.0',
    id: 'test-lifecycle',
    metadata: {
      totalFrames: 10,
      fps: 30,
      duration: 0.33,
      aspectRatio: '16:9',
    },
    variants: [
      {
        id: 'desktop',
        minWidth: 0,
        width: 1920,
        height: 1080,
        format: 'image/webp',
        packing: 'individual',
        frameTemplate: 'frame_%04d.webp',
        frameStartIndex: 0,
        framesCount: 10,
      },
    ],
  };

  it('engine.destroy() releases all cached bitmaps, removes listeners, and leaks zero resources', async () => {
    const closedBitmaps: any[] = [];
    const mockBitmap = {
      width: 1920,
      height: 1080,
      close: vi.fn(() => {
        closedBitmaps.push(mockBitmap);
      }),
    };

    const listeners: Record<string, ((...args: any[]) => void)[]> = {};
    const mockCanvas = {
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
      width: 1920,
      height: 1080,
      getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
      addEventListener: vi.fn((event: string, fn: (...args: any[]) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      }),
      removeEventListener: vi.fn((event: string, fn: (...args: any[]) => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((f) => f !== fn);
        }
      }),
    } as unknown as HTMLCanvasElement;

    const engine = new Zoetrope({
      canvas: mockCanvas,
      manifest: minimalManifest,
      playback: { mode: 'manual' },
    });

    await engine.init();

    // Insert bitmap into engine cache directly
    engine.getCache().put(0, mockBitmap as any, 1000);
    expect(engine.getCache().has(0)).toBe(true);

    // Assert canvas context listeners were registered
    expect(mockCanvas.addEventListener).toHaveBeenCalledWith('contextlost', expect.any(Function));
    expect(mockCanvas.addEventListener).toHaveBeenCalledWith('contextrestored', expect.any(Function));

    // Destroy
    engine.destroy();

    // Verify cache is cleared and bitmap.close() was called
    expect(engine.getCache().getStats().frameCount).toBe(0);
    expect(mockBitmap.close).toHaveBeenCalledTimes(1);

    // Verify canvas event listeners were removed
    expect(mockCanvas.removeEventListener).toHaveBeenCalledWith('contextlost', expect.any(Function));
    expect(mockCanvas.removeEventListener).toHaveBeenCalledWith('contextrestored', expect.any(Function));
  });

  it('surfaces canvas contextlost event as a public RendererError', async () => {
    let contextLostHandler: ((...args: any[]) => void) | null = null;
    const mockCanvas = {
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
      width: 1920,
      height: 1080,
      getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
      addEventListener: vi.fn((event: string, fn: (...args: any[]) => void) => {
        if (event === 'contextlost') contextLostHandler = fn;
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const engine = new Zoetrope({
      canvas: mockCanvas,
      manifest: minimalManifest,
      playback: { mode: 'manual' },
    });

    await engine.init();

    const errorHandler = vi.fn();
    engine.on('error', errorHandler);

    // Trigger context lost
    expect(contextLostHandler).toBeDefined();
    const fakeEvent = { preventDefault: vi.fn() };
    contextLostHandler!(fakeEvent);

    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler.mock.calls[0][0].name).toBe('RendererError');

    engine.destroy();
  });
});
