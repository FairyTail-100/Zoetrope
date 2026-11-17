import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateManifestFile } from '../packages/compiler/src/validator.js';
import { compile } from '../packages/compiler/src/compiler.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

describe('Phase 2: Compiler Validator & Fault Injection Test Suite', () => {
  const fixtureDir = path.resolve('tests/fixtures/validator-test');
  const clipPath = path.join(fixtureDir, 'clip.mp4');
  const baseOutDir = path.join(fixtureDir, 'base-out');

  beforeAll(async () => {
    fs.mkdirSync(fixtureDir, { recursive: true });

    // Generate a 10-frame test clip
    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=0.33:size=320x240:rate=30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      clipPath,
    ]);

    // Compile a valid base sequence with checksums
    await compile({
      input: clipPath,
      outputDir: baseOutDir,
      id: 'val-test',
      fps: 30,
      format: 'webp',
      variants: [
        { id: 'desktop', width: 320, height: 240, minWidth: 0 }
      ],
      checksum: true,
      force: true,
    });
  });

  afterAll(() => {
    try {
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch {}
  });

  it('validates a clean compiled sequence with 0 errors in fast and deep mode', async () => {
    const manifestPath = path.join(baseOutDir, 'manifest.json');
    const fastResult = await validateManifestFile(manifestPath, { deep: false });
    expect(fastResult.valid).toBe(true);
    expect(fastResult.errors).toHaveLength(0);
    expect(fastResult.checkedFrames).toBeGreaterThan(0);

    const deepResult = await validateManifestFile(manifestPath, { deep: true });
    expect(deepResult.valid).toBe(true);
    expect(deepResult.errors).toHaveLength(0);
    expect(deepResult.deepValidated).toBe(true);
  });

  it('detects FILE_NOT_FOUND when a frame file is deleted', async () => {
    const corruptDir = path.join(fixtureDir, 'test-missing-file');
    fs.cpSync(baseOutDir, corruptDir, { recursive: true });

    // Delete frame 2
    const frame2 = path.join(corruptDir, 'desktop', 'frame_0003.webp');
    if (fs.existsSync(frame2)) fs.unlinkSync(frame2);

    const result = await validateManifestFile(path.join(corruptDir, 'manifest.json'), { deep: false });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'FILE_NOT_FOUND');
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/missing on disk/);
  });

  it('detects SIZE_MISMATCH when a frame file byte length is modified', async () => {
    const corruptDir = path.join(fixtureDir, 'test-size-mismatch');
    fs.cpSync(baseOutDir, corruptDir, { recursive: true });

    // Truncate frame 1 to 50 bytes
    const frame1 = path.join(corruptDir, 'desktop', 'frame_0001.webp');
    const fd = fs.openSync(frame1, 'w');
    fs.writeSync(fd, Buffer.alloc(50));
    fs.closeSync(fd);

    const result = await validateManifestFile(path.join(corruptDir, 'manifest.json'), { deep: false });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'SIZE_MISMATCH');
    expect(err).toBeDefined();
    expect(err?.actual).toBe(50);
  });

  it('detects CHECKSUM_MISMATCH when a frame payload is altered without changing size', async () => {
    const corruptDir = path.join(fixtureDir, 'test-checksum-mismatch');
    fs.cpSync(baseOutDir, corruptDir, { recursive: true });

    // Invert some bytes in frame 1 without altering file size
    const frame1 = path.join(corruptDir, 'desktop', 'frame_0002.webp');
    const buf = fs.readFileSync(frame1);
    buf[100] = buf[100] ^ 0xff; // flip byte
    fs.writeFileSync(frame1, buf);

    const result = await validateManifestFile(path.join(corruptDir, 'manifest.json'), { deep: false });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'CHECKSUM_MISMATCH');
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/SHA-256 checksum mismatch/);
  });

  it('detects DIMENSION_MISMATCH in deep mode when frame image dimensions differ from manifest', async () => {
    const corruptDir = path.join(fixtureDir, 'test-dimension-mismatch');
    fs.cpSync(baseOutDir, corruptDir, { recursive: true });

    // In manifest.json, alter desktop width to 640 instead of 320
    const mPath = path.join(corruptDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    manifest.variants[0].width = 640;
    fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));

    const result = await validateManifestFile(mPath, { deep: true });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'DIMENSION_MISMATCH');
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/Frame dimensions \(320x240\) do not match variant declaration/);
  });

  it('detects GAP_IN_FRAMES when a frame id sequence has missing indices', async () => {
    const corruptDir = path.join(fixtureDir, 'test-gap-frames');
    fs.cpSync(baseOutDir, corruptDir, { recursive: true });

    const mPath = path.join(corruptDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    // Make frame 3 have id 5 (skipping 3 and 4)
    manifest.variants[0].frames[3].id = 5;
    fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));

    const result = await validateManifestFile(mPath, { deep: false });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'GAP_IN_FRAMES');
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/Discontinuity in frame sequence/);
  });
});
