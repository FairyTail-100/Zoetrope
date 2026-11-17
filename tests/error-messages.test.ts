import { describe, it, expect, vi } from 'vitest';
import { Zoetrope } from '../packages/core/src/engine.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

describe('User-Facing Polish: 5 Most Common Error Messages', () => {
  // Mock canvas helper
  const makeCanvas = () =>
    ({
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
      width: 1280,
      height: 720,
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement);

  // 1. Canvas not found
  it('1. canvas not found: throws clear RendererError when canvas option is missing', async () => {
    const engine = new Zoetrope({
      canvas: null as any,
      manifest: 'manifest.json',
    });

    await expect(engine.init()).rejects.toThrow(
      /Target canvas not found. Ensure options.canvas is a valid HTMLCanvasElement/
    );
  });

  // 2. Manifest 404
  it('2. manifest 404: surfaces clear ManifestError indicating file not found', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
    } as any);

    try {
      const engine = new Zoetrope({
        canvas: makeCanvas(),
        manifest: '/missing/manifest.json',
      });

      await expect(engine.init()).rejects.toThrow(
        /Manifest file not found \(404\) at "\/missing\/manifest\.json"/
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 3. Wrong MIME type from server
  it('3. wrong MIME type: surfaces error when server returns text/html instead of application/json', async () => {
    const headers = new Headers();
    headers.set('content-type', 'text/html; charset=utf-8');

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers,
      text: () => Promise.resolve('<!DOCTYPE html><html></html>'),
    } as any);

    try {
      const engine = new Zoetrope({
        canvas: makeCanvas(),
        manifest: '/assets/manifest.json',
      });

      await expect(engine.init()).rejects.toThrow(
        /Server returned unexpected MIME type "text\/html/
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 4. CORS failure
  it('4. CORS failure: surfaces clear guidance on CORS configuration', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (CORS header missing)'));

    try {
      const engine = new Zoetrope({
        canvas: makeCanvas(),
        manifest: 'https://cdn.example.com/assets/manifest.json',
      });

      await expect(engine.init()).rejects.toThrow(
        /This typically indicates a CORS configuration error/
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 5. FFmpeg missing
  it('5. ffmpeg missing: produces descriptive actionable error message when binary is not found', async () => {
    const origEnv = process.env.CE_FFMPEG;
    process.env.CE_FFMPEG = 'non_existent_ffmpeg_binary_path_12345';

    try {
      await expect(runFFmpeg(['-version'])).rejects.toThrow(
        /FFmpeg binary not found/
      );
    } finally {
      if (origEnv !== undefined) {
        process.env.CE_FFMPEG = origEnv;
      } else {
        delete process.env.CE_FFMPEG;
      }
    }
  });
});
