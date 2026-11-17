import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compile, CompileProgressEvent } from '../packages/compiler/src/compiler.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

describe('Regression: Compiler Progress & Path Handling', () => {
  const baseDir = path.resolve('tests/fixtures/path with spaces in name');
  const clipPath = path.join(baseDir, 'test sample clip.mp4');
  const outDir = path.join(baseDir, 'output folder');

  beforeAll(async () => {
    fs.mkdirSync(baseDir, { recursive: true });
    if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });

    // Generate 1.5s clip with video and audio in a path with spaces (<=2s, <=48 frames, 320x180)
    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1.5:size=320x180:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.5',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      clipPath,
    ]);
  }, 30000);

  afterAll(() => {
    try {
      if (fs.existsSync(baseDir)) {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('compiles a 3s clip from a path containing spaces with valid progress and finishes <60s', async () => {
    const startTime = Date.now();
    const progressEvents: CompileProgressEvent[] = [];

    const manifest = await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 24,
      format: 'webp',
      variants: [
        { id: 'standard', width: 320, height: 240, minWidth: 0 },
      ],
      force: true,
      onProgress: (p) => {
        progressEvents.push(p);
      },
    });

    const elapsedMs = Date.now() - startTime;
    expect(elapsedMs).toBeLessThan(60000);

    // Assert total > 0 was reported during extraction
    const extractionEvents = progressEvents.filter((e) => e.stage === 'extracting');
    expect(extractionEvents.length).toBeGreaterThan(0);

    for (const ev of extractionEvents) {
      if (ev.total !== undefined) {
        expect(ev.total).toBeGreaterThan(0);
      }
      if (ev.frame !== undefined) {
        expect(ev.frame).toBeGreaterThanOrEqual(0);
      }
    }

    // Verify at least one progress event had total > 0
    const eventsWithTotal = extractionEvents.filter((e) => e.total !== undefined && e.total > 0);
    expect(eventsWithTotal.length).toBeGreaterThan(0);
    expect(eventsWithTotal[0].total).toBe(36); // 1.5 seconds * 24 fps

    // Verify manifest
    expect(manifest.metadata.totalFrames).toBe(36);
    expect(manifest.variants[0].framesCount).toBe(36);
  }, 60000);
});

