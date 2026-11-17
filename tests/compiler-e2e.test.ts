import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runFFmpeg, extractVideoFrames } from '../packages/compiler/src/ffmpeg.js';
import { buildChunksFromFiles, buildIndividualFrameRecords } from '../packages/compiler/src/pack-builder.js';
import { generateManifest } from '../packages/compiler/src/manifest-builder.js';
import { unpackCEPK } from '../packages/streaming/src/binary-pack.js';

describe('Compiler End-to-End Pipeline', () => {
  const tmpDir = path.join(process.cwd(), 'temp-compiler-test');
  const testVideo = path.join(tmpDir, 'test-source.mp4');
  const outputDir = path.join(tmpDir, 'output');

  beforeAll(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Generate a 1-second 30fps test video (30 frames)
    await runFFmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=320x180:rate=30',
      '-pix_fmt',
      'yuv420p',
      testVideo,
    ]);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('extracts frames, packages them into CEPK binary packs, and validates the manifest', async () => {
    const rawFramesDir = path.join(outputDir, 'raw-frames');
    const extraction = await extractVideoFrames(testVideo, rawFramesDir, {
      fps: 30,
      width: 320,
      height: 180,
      format: 'webp',
      quality: 75,
    });

    expect(extraction.framesCount).toBe(30);
    expect(extraction.frameFiles.length).toBe(30);

    // Build chunks (10 frames per chunk -> 3 chunks)
    const chunksDir = path.join(outputDir, 'desktop', 'chunks');
    const { chunks, totalBytes } = buildChunksFromFiles({
      frameFiles: extraction.frameFiles,
      outputChunksDir: chunksDir,
      chunkSize: 10,
      chunkFilePrefix: 'chunk',
    });

    expect(chunks.length).toBe(3);
    expect(totalBytes).toBeGreaterThan(0);

    // Verify first chunk can be unpacked
    const firstChunkBuf = fs.readFileSync(path.join(chunksDir, chunks[0].src));
    const unpacked = unpackCEPK(firstChunkBuf);
    expect(unpacked.frames.size).toBe(10);
    expect(unpacked.frames.has(0)).toBe(true);
    expect(unpacked.frames.has(9)).toBe(true);

    // Generate manifest
    const manifest = generateManifest({
      id: 'e2e-test',
      totalFrames: 30,
      fps: 30,
      outputDir,
      variants: [
        {
          id: 'desktop',
          minWidth: 600,
          width: 320,
          height: 180,
          format: 'image/webp',
          packing: 'chunked',
          chunkSize: 10,
          chunks: chunks.map((c) => ({
            ...c,
            src: `desktop/chunks/${c.src}`,
          })),
        },
        {
          id: 'mobile',
          minWidth: 0,
          width: 160,
          height: 90,
          format: 'image/webp',
          packing: 'individual',
          frames: buildIndividualFrameRecords(extraction.frameFiles).map((f) => ({
            ...f,
            src: `raw-frames/${f.src}`,
          })),
        },
      ],
    });

    expect(manifest.id).toBe('e2e-test');
    expect(manifest.metadata.totalFrames).toBe(30);
    expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);
  });
});
