import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compile } from '../packages/compiler/src/compiler.js';
import { probeMedia } from '../packages/compiler/src/probe.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

describe('Phase 2: Compiler Edge-Case Test Suite', () => {
  const edgeDir = path.resolve('tests/fixtures/edge-cases');
  const outBase = path.resolve('tests/fixtures/edge-out');

  const vfrClip = path.join(edgeDir, 'vfr-input.mp4');
  const rotatedClip = path.join(edgeDir, 'portrait-rotated.mp4');
  const rotate90MetaClip = path.join(edgeDir, 'rotate-90-metadata.mp4');
  const tenBitClip = path.join(edgeDir, 'ten-bit.mp4');
  const audioOnlyClip = path.join(edgeDir, 'audio-only.mp4');
  const zeroLengthClip = path.join(edgeDir, 'zero-length.mp4');
  const specialPathClip = path.join(edgeDir, 'clip with spaces and [brackets] #1.mp4');

  beforeAll(async () => {
    fs.mkdirSync(edgeDir, { recursive: true });
    fs.mkdirSync(outBase, { recursive: true });

    // 1. VFR input (non-uniform timestamps via frame decimation with -vsync vfr)
    if (fs.existsSync(vfrClip)) fs.unlinkSync(vfrClip);
    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1.0:size=320x240:rate=30',
      '-vf', 'select=not(mod(n\\,2))',
      '-vsync', 'vfr',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      vfrClip,
    ]);

    // 2. Portrait smartphone video (240x320 vertical orientation)
    if (fs.existsSync(rotatedClip)) fs.unlinkSync(rotatedClip);
    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=240x320:rate=30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      rotatedClip,
    ]);

    // 2b. Real landscape 320x180 video (top half pure Red, bottom half pure Blue) tagged with 90-degree display rotation metadata
    const rawLandscapeClip = path.join(edgeDir, 'raw-landscape-rb.mp4');
    if (fs.existsSync(rawLandscapeClip)) fs.unlinkSync(rawLandscapeClip);
    if (fs.existsSync(rotate90MetaClip)) fs.unlinkSync(rotate90MetaClip);
    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0xFF0000:s=320x90:d=0.2:r=30',
      '-f', 'lavfi', '-i', 'color=c=0x0000FF:s=320x90:d=0.2:r=30',
      '-filter_complex', '[0:v][1:v]vstack=inputs=2[v]',
      '-map', '[v]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      rawLandscapeClip,
    ]);
    await runFFmpeg([
      '-y',
      '-display_rotation', '90',
      '-i', rawLandscapeClip,
      '-c', 'copy',
      rotate90MetaClip,
    ]);

    // 3. 10-bit input (yuv420p10le)
    if (!fs.existsSync(tenBitClip)) {
      await runFFmpeg([
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=320x240:rate=30',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p10le',
        tenBitClip,
      ]);
    }

    // 4. Audio-only file
    if (!fs.existsSync(audioOnlyClip)) {
      await runFFmpeg([
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5',
        '-c:a', 'aac',
        audioOnlyClip,
      ]);
    }

    // 5. Zero-length file
    fs.writeFileSync(zeroLengthClip, Buffer.alloc(0));

    // 6. Special character path
    if (!fs.existsSync(specialPathClip)) {
      await runFFmpeg([
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=320x240:rate=30',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        specialPathClip,
      ]);
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(edgeDir)) fs.rmSync(edgeDir, { recursive: true, force: true });
      if (fs.existsSync(outBase)) fs.rmSync(outBase, { recursive: true, force: true });
    } catch {}
  });

  it('handles VFR input by normalizing to CFR without dropped or corrupted frames', async () => {
    const outDir = path.join(outBase, 'vfr-out');
    const manifest = await compile({
      input: vfrClip,
      outputDir: outDir,
      fps: 30,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      force: true,
    });

    expect(manifest.metadata.fps).toBe(30);
    expect(manifest.metadata.totalFrames).toBeGreaterThanOrEqual(10);
    expect(fs.existsSync(path.join(outDir, 'desktop', 'frame_0001.webp'))).toBe(true);
  });

  it('correctly honors rotation and aspect ratio on portrait smartphone video', async () => {
    const probe = await probeMedia(rotatedClip);
    expect(probe.effectiveWidth).toBe(240);
    expect(probe.effectiveHeight).toBe(320);

    const outDir = path.join(outBase, 'rotated-out');
    const manifest = await compile({
      input: rotatedClip,
      outputDir: outDir,
      variants: [{ id: 'portrait', width: 240, height: 320, minWidth: 0 }],
      force: true,
    });

    expect(manifest.variants[0].width).toBe(240);
    expect(manifest.variants[0].height).toBe(320);
    expect(fs.existsSync(path.join(outDir, 'portrait', 'frame_0001.webp'))).toBe(true);
  });

  it('auto-rotates a real rotate-90 displaymatrix clip to portrait dimensions and verifies rotated pixel orientation', async () => {
    const probe = await probeMedia(rotate90MetaClip);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(180);
    expect([90, 270]).toContain(probe.rotation);
    expect(probe.effectiveWidth).toBe(180);
    expect(probe.effectiveHeight).toBe(320);

    const outDir = path.join(outBase, 'rotate-90-meta-out');
    // Compile WITHOUT explicit variant dimensions so compiler uses probeInfo.effectiveWidth x effectiveHeight
    const manifest = await compile({
      input: rotate90MetaClip,
      outputDir: outDir,
      force: true,
    });

    expect(manifest.variants[0].width).toBe(180);
    expect(manifest.variants[0].height).toBe(320);
    expect(manifest.metadata.aspectRatio).toBe('180:320');

    const frame1Path = path.join(outDir, 'desktop', 'frame_0001.webp');
    expect(fs.existsSync(frame1Path)).toBe(true);

    // Verify actual image dimensions and rotated left/right pixel colors via sharp
    const sharpModule = await import('sharp');
    const sharp = (sharpModule.default || sharpModule) as any;
    const { data, info } = await sharp(frame1Path).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(180);
    expect(info.height).toBe(320);

    // Sample left center (x=45, y=160) and right center (x=135, y=160)
    // In unrotated 320x180, top half was Red and bottom half was Blue.
    // After 90-degree rotation to 180x320, left and right halves must be Red and Blue (not top/bottom!).
    const leftIdx = (160 * info.width + 45) * info.channels;
    const rightIdx = (160 * info.width + 135) * info.channels;
    const leftR = data[leftIdx], leftB = data[leftIdx + 2];
    const rightR = data[rightIdx], rightB = data[rightIdx + 2];

    // One side is strongly Red (R > 180, B < 50) and the opposite side is strongly Blue (B > 180, R < 50)
    const leftIsRedRightIsBlue = leftR > 180 && leftB < 50 && rightB > 180 && rightR < 50;
    const leftIsBlueRightIsRed = leftB > 180 && leftR < 50 && rightR > 180 && rightB < 50;
    expect(leftIsRedRightIsBlue || leftIsBlueRightIsRed).toBe(true);
  });

  it('emits multi-format sources (AVIF + WebP) and per-variant stats including decodedRgbaBytesPerFrame', async () => {
    const outDir = path.join(outBase, 'multiformat-out');
    const manifest = await compile({
      input: rotatedClip,
      outputDir: outDir,
      formats: ['avif', 'webp'],
      variants: [{ id: 'desktop', width: 240, height: 320, minWidth: 0 }],
      checksum: true,
      force: true,
    });

    const v = manifest.variants[0];
    expect(v.formats).toEqual(['image/avif', 'image/webp']);
    expect(v.sources).toBeDefined();
    expect(v.sources).toHaveLength(2);
    expect(v.sources![0].format).toBe('image/avif');
    expect(v.sources![1].format).toBe('image/webp');
    expect(v.stats?.decodedRgbaBytesPerFrame).toBe(240 * 320 * 4);
    expect(v.stats?.estimatedDecodedMemoryBytes).toBe(240 * 320 * 4 * manifest.metadata.totalFrames);
    expect(fs.existsSync(path.join(outDir, 'desktop', 'frame_0001.avif'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'desktop', 'frame_0001.webp'))).toBe(true);
  });

  it('correctly compiles 10-bit input (yuv420p10le)', async () => {
    const probe = await probeMedia(tenBitClip);
    expect(probe.is10Bit).toBe(true);

    const outDir = path.join(outBase, 'tenbit-out');
    const manifest = await compile({
      input: tenBitClip,
      outputDir: outDir,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      force: true,
    });

    expect(manifest.metadata.totalFrames).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outDir, 'desktop', 'frame_0001.webp'))).toBe(true);
  });

  it('fails gracefully with an informative error on audio-only input', async () => {
    const outDir = path.join(outBase, 'audio-out');
    await expect(compile({
      input: audioOnlyClip,
      outputDir: outDir,
      force: true,
    })).rejects.toThrow(/audio streams only/);
  });

  it('fails gracefully with an informative error on zero-length file', async () => {
    const outDir = path.join(outBase, 'zero-out');
    await expect(compile({
      input: zeroLengthClip,
      outputDir: outDir,
      force: true,
    })).rejects.toThrow(/zero-length/);
  });

  it('successfully handles media paths with spaces, brackets, and special characters', async () => {
    const outDir = path.join(outBase, 'special-out [dir] #1');
    const manifest = await compile({
      input: specialPathClip,
      outputDir: outDir,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      force: true,
    });

    expect(manifest.metadata.totalFrames).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outDir, 'desktop', 'frame_0001.webp'))).toBe(true);
  });
});
