import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, Browser } from '@playwright/test';
import { compile } from '../packages/compiler/src/compiler.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

/**
 * Phase 2 (F5): Color Accuracy Golden Test Suite in Chromium
 *
 * Stated Tolerances (8-bit 4:2:0 YUV + WebP Q=98 lossy compression -> Chromium createImageBitmap -> Canvas 2D getImageData):
 * - Neutral 5-step gray ramp (32, 80, 128, 176, 224): ±4 RGB units per channel, neutral balance |R-G| <= 3, |G-B| <= 3 (1 LSB in 8-bit Cb/Cr equals 1.77-1.85 RGB units)
 * - Saturated skin-tone patches (rgb(194, 150, 130) & rgb(216, 138, 108)): ±6 RGB units per channel
 * - Primary RGB bars (limited-range BT.709, full-range BT.709, untagged): ±10 RGB units per channel
 */
describe('Phase 2: Color Correctness Golden Test Suite (Chromium)', () => {
  const fixtureDir = path.resolve('tests/fixtures/color-test');
  const outRootDir = path.resolve('tests/fixtures/color-test-out');
  let browser: Browser;

  beforeAll(async () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(outRootDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    try {
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
      if (fs.existsSync(outRootDir)) fs.rmSync(outRootDir, { recursive: true, force: true });
    } catch {}
  });

  async function sampleWebpPixelsInChromium(
    webpPath: string,
    coords: Array<{ name: string; x: number; y: number }>
  ): Promise<Record<string, { r: number; g: number; b: number }>> {
    const b64 = fs.readFileSync(webpPath).toString('base64');
    const page = await browser.newPage();
    try {
      const fnStr = `(async ({ b64, pts }) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const blob = new Blob([u8], { type: 'image/webp' });
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const out = {};
        for (const pt of pts) {
          const d = ctx.getImageData(pt.x, pt.y, 1, 1).data;
          out[pt.name] = { r: d[0], g: d[1], b: d[2] };
        }
        return out;
      })`;
      return await page.evaluate(new Function('arg', `return (${fnStr})(arg)`) as any, {
        b64,
        pts: coords,
      });
    } finally {
      await page.close();
    }
  }

  it('1. Limited-range BT.709 (tv, bt709) primary RGB bars decode within ±10 RGB units', async () => {
    const clipPath = path.join(fixtureDir, 'bt709-limited.mp4');
    const outDir = path.join(outRootDir, 'bt709-limited');

    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0xFF0000:s=200x200:d=0.2',
      '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=200x200:d=0.2',
      '-f', 'lavfi', '-i', 'color=c=0x0000FF:s=200x200:d=0.2',
      '-filter_complex',
      '[0:v][1:v][2:v]hstack=inputs=3,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv',
      '-c:v', 'libx264', '-crf', '10',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      clipPath,
    ]);

    await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      format: 'webp',
      quality: 98,
      variants: [{ id: 'desktop', width: 600, height: 200, minWidth: 0, fit: 'cover' }],
      force: true,
    });

    const samples = await sampleWebpPixelsInChromium(
      path.join(outDir, 'desktop', 'frame_0001.webp'),
      [
        { name: 'red', x: 100, y: 100 },
        { name: 'green', x: 300, y: 100 },
        { name: 'blue', x: 500, y: 100 },
      ]
    );

    expect(samples.red.r).toBeGreaterThanOrEqual(245);
    expect(samples.red.g).toBeLessThanOrEqual(10);
    expect(samples.red.b).toBeLessThanOrEqual(10);

    expect(samples.green.r).toBeLessThanOrEqual(10);
    expect(samples.green.g).toBeGreaterThanOrEqual(245);
    expect(samples.green.b).toBeLessThanOrEqual(10);

    expect(samples.blue.r).toBeLessThanOrEqual(10);
    expect(samples.blue.g).toBeLessThanOrEqual(10);
    expect(samples.blue.b).toBeGreaterThanOrEqual(245);
  });

  it('2. Full-range BT.709 (pc, bt709) preserves near-black (16), mid-gray (128), and near-white (240) without range clipping', async () => {
    const clipPath = path.join(fixtureDir, 'bt709-full.mp4');
    const outDir = path.join(outRootDir, 'bt709-full');

    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0x101010:s=200x200:d=0.2',
      '-f', 'lavfi', '-i', 'color=c=0x808080:s=200x200:d=0.2',
      '-f', 'lavfi', '-i', 'color=c=0xF0F0F0:s=200x200:d=0.2',
      '-filter_complex',
      '[0:v][1:v][2:v]hstack=inputs=3,scale=out_color_matrix=bt709:out_range=pc,format=yuvj420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=pc',
      '-c:v', 'libx264', '-crf', '10',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc',
      clipPath,
    ]);

    await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      format: 'webp',
      quality: 98,
      variants: [{ id: 'desktop', width: 600, height: 200, minWidth: 0, fit: 'cover' }],
      force: true,
    });

    const samples = await sampleWebpPixelsInChromium(
      path.join(outDir, 'desktop', 'frame_0001.webp'),
      [
        { name: 'nearBlack', x: 100, y: 100 },
        { name: 'midGray', x: 300, y: 100 },
        { name: 'nearWhite', x: 500, y: 100 },
      ]
    );

    // If full-range pc was mistakenly treated as limited-range tv, nearBlack (16) would crush to 0 and nearWhite (240) would clip to 255!
    expect(Math.abs(samples.nearBlack.r - 16)).toBeLessThanOrEqual(4);
    expect(Math.abs(samples.midGray.r - 128)).toBeLessThanOrEqual(4);
    expect(Math.abs(samples.nearWhite.r - 240)).toBeLessThanOrEqual(4);
  });

  it('3. Untagged source video decodes with accurate color levels within ±8 RGB units', async () => {
    const clipPath = path.join(fixtureDir, 'untagged.mp4');
    const outDir = path.join(outRootDir, 'untagged');

    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0xDC322F:s=200x200:d=0.2', // crimson (220, 50, 47)
      '-f', 'lavfi', '-i', 'color=c=0x268BD2:s=200x200:d=0.2', // blue (38, 139, 210)
      '-filter_complex', '[0:v][1:v]hstack=inputs=2,format=yuv420p',
      '-c:v', 'libx264', '-crf', '10',
      clipPath,
    ]);

    await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      format: 'webp',
      quality: 98,
      variants: [{ id: 'desktop', width: 400, height: 200, minWidth: 0, fit: 'cover' }],
      force: true,
    });

    const samples = await sampleWebpPixelsInChromium(
      path.join(outDir, 'desktop', 'frame_0001.webp'),
      [
        { name: 'crimson', x: 100, y: 100 },
        { name: 'oceanBlue', x: 300, y: 100 },
      ]
    );

    expect(Math.abs(samples.crimson.r - 220)).toBeLessThanOrEqual(8);
    expect(Math.abs(samples.crimson.g - 50)).toBeLessThanOrEqual(8);
    expect(Math.abs(samples.crimson.b - 47)).toBeLessThanOrEqual(8);

    expect(Math.abs(samples.oceanBlue.r - 38)).toBeLessThanOrEqual(8);
    expect(Math.abs(samples.oceanBlue.g - 139)).toBeLessThanOrEqual(8);
    expect(Math.abs(samples.oceanBlue.b - 210)).toBeLessThanOrEqual(8);
  });

  it('4. 5-level neutral mid-gray ramp (32, 80, 128, 176, 224) decodes within ±4 RGB units with zero chroma cast', async () => {
    const clipPath = path.join(fixtureDir, 'gray-ramp-5.mp4');
    const outDir = path.join(outRootDir, 'gray-ramp-5');
    const grayLevels = [32, 80, 128, 176, 224];

    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=120x200:d=0.2,format=rgb24,lutrgb=r=32:g=32:b=32',
      '-f', 'lavfi', '-i', 'color=c=black:s=120x200:d=0.2,format=rgb24,lutrgb=r=80:g=80:b=80',
      '-f', 'lavfi', '-i', 'color=c=black:s=120x200:d=0.2,format=rgb24,lutrgb=r=128:g=128:b=128',
      '-f', 'lavfi', '-i', 'color=c=black:s=120x200:d=0.2,format=rgb24,lutrgb=r=176:g=176:b=176',
      '-f', 'lavfi', '-i', 'color=c=black:s=120x200:d=0.2,format=rgb24,lutrgb=r=224:g=224:b=224',
      '-filter_complex',
      '[0:v][1:v][2:v][3:v][4:v]hstack=inputs=5,scale=flags=accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:range=tv',
      '-c:v', 'libx264', '-crf', '10',
      '-colorspace', 'bt709', '-color_range', 'tv',
      clipPath,
    ]);

    await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      format: 'webp',
      quality: 98,
      variants: [{ id: 'desktop', width: 600, height: 200, minWidth: 0, fit: 'cover' }],
      force: true,
    });

    const coords = grayLevels.map((lvl, idx) => ({
      name: `g${lvl}`,
      x: idx * 120 + 60,
      y: 100,
    }));

    const samples = await sampleWebpPixelsInChromium(
      path.join(outDir, 'desktop', 'frame_0001.webp'),
      coords
    );

    for (const lvl of grayLevels) {
      const p = samples[`g${lvl}`];
      expect(Math.abs(p.r - lvl)).toBeLessThanOrEqual(4);
      expect(Math.abs(p.g - lvl)).toBeLessThanOrEqual(4);
      expect(Math.abs(p.b - lvl)).toBeLessThanOrEqual(4);
      // Neutral chroma balance (1 LSB in 8-bit Cb/Cr = 1.77-1.85 RGB units)
      expect(Math.abs(p.r - p.g)).toBeLessThanOrEqual(3);
      expect(Math.abs(p.g - p.b)).toBeLessThanOrEqual(3);
    }
  });

  it('5. Saturated skin-tone patches (rgb(194, 150, 130) & rgb(216, 138, 108)) decode within ±6 RGB units', async () => {
    const clipPath = path.join(fixtureDir, 'skin-tone.mp4');
    const outDir = path.join(outRootDir, 'skin-tone');

    // Patch 1: ColorChecker Light Skin #C29682 = rgb(194, 150, 130)
    // Patch 2: Warm Saturated Skin #D88A6C = rgb(216, 138, 108)
    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0xC29682:s=200x200:d=0.2',
      '-f', 'lavfi', '-i', 'color=c=0xD88A6C:s=200x200:d=0.2',
      '-filter_complex',
      '[0:v][1:v]hstack=inputs=2,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv',
      '-c:v', 'libx264', '-crf', '10',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      clipPath,
    ]);

    await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      format: 'webp',
      quality: 98,
      variants: [{ id: 'desktop', width: 400, height: 200, minWidth: 0, fit: 'cover' }],
      force: true,
    });

    const samples = await sampleWebpPixelsInChromium(
      path.join(outDir, 'desktop', 'frame_0001.webp'),
      [
        { name: 'lightSkin', x: 100, y: 100 },
        { name: 'warmSaturatedSkin', x: 300, y: 100 },
      ]
    );

    expect(Math.abs(samples.lightSkin.r - 194)).toBeLessThanOrEqual(6);
    expect(Math.abs(samples.lightSkin.g - 150)).toBeLessThanOrEqual(6);
    expect(Math.abs(samples.lightSkin.b - 130)).toBeLessThanOrEqual(6);

    expect(Math.abs(samples.warmSaturatedSkin.r - 216)).toBeLessThanOrEqual(6);
    expect(Math.abs(samples.warmSaturatedSkin.g - 138)).toBeLessThanOrEqual(6);
    expect(Math.abs(samples.warmSaturatedSkin.b - 108)).toBeLessThanOrEqual(6);
  });

  it('6. Saturated yellow-green (RGB 190, 255, 0) from BT.709 limited-range decodes within ±3 RGB units in Chromium', async () => {
    const clipPath = path.join(fixtureDir, 'yg-bt709.mp4');
    const outDir = path.join(outRootDir, 'yg-bt709-out');

    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0xBEFF00:s=200x200:d=0.2',
      '-vf', 'format=rgb24,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      clipPath,
    ]);

    await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      format: 'webp',
      quality: 100,
      variants: [{ id: 'desktop', width: 200, height: 200, minWidth: 0, fit: 'cover' }],
      force: true,
    });

    const samples = await sampleWebpPixelsInChromium(
      path.join(outDir, 'desktop', 'frame_0001.webp'),
      [{ name: 'yellowGreen', x: 100, y: 100 }]
    );

    const yg = samples.yellowGreen;
    expect(Math.abs(yg.r - 190)).toBeLessThanOrEqual(3);
    expect(Math.abs(yg.g - 255)).toBeLessThanOrEqual(3);
    expect(Math.abs(yg.b - 0)).toBeLessThanOrEqual(3);
  });

  it('7. Saturated yellow-green (RGB 190, 255, 0) from BT.601 limited-range decodes within ±3 RGB units in Chromium', async () => {
    const clipPath = path.join(fixtureDir, 'yg-bt601.mp4');
    const outDir = path.join(outRootDir, 'yg-bt601-out');

    await runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0xBEFF00:s=200x200:d=0.2',
      '-vf', 'format=rgb24,scale=out_color_matrix=bt601:out_range=tv,format=yuv420p',
      '-c:v', 'libx264',
      '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', '-color_range', 'tv',
      clipPath,
    ]);

    await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      format: 'webp',
      quality: 100,
      variants: [{ id: 'desktop', width: 200, height: 200, minWidth: 0, fit: 'cover' }],
      force: true,
    });

    const samples = await sampleWebpPixelsInChromium(
      path.join(outDir, 'desktop', 'frame_0001.webp'),
      [{ name: 'yellowGreen', x: 100, y: 100 }]
    );

    const yg = samples.yellowGreen;
    expect(Math.abs(yg.r - 190)).toBeLessThanOrEqual(3);
    expect(Math.abs(yg.g - 255)).toBeLessThanOrEqual(3);
    expect(Math.abs(yg.b - 0)).toBeLessThanOrEqual(3);
  });
});
