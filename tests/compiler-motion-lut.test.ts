import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compile } from '../packages/compiler/src/compiler.js';
import { computeMotionLut } from '../packages/compiler/src/motion-lut.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

describe('Phase 2: Heuristic Motion-LUT Stretch Test Suite', () => {
  const lutDir = path.resolve('tests/fixtures/motion-lut-test');
  const outDir = path.resolve('tests/fixtures/motion-lut-out');
  const clipPath = path.join(lutDir, 'motion-contrast.mp4');

  beforeAll(async () => {
    fs.mkdirSync(lutDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    // Generate clip with alternating motion:
    // Part 1 (0.0s to 1.0s): static freeze frame (zero motion)
    // Part 2 (1.0s to 2.0s): high motion dynamic noise pattern
    if (!fs.existsSync(clipPath)) {
      await runFFmpeg([
        '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1.0:r=30',
        '-f', 'lavfi', '-i', 'testsrc=duration=1.0:size=320x240:rate=30',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1[outv]',
        '-map', '[outv]',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        clipPath,
      ]);
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(lutDir)) fs.rmSync(lutDir, { recursive: true, force: true });
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    } catch {}
  });

  it('computes heuristic motion LUT where high-motion segment has steeper slope than static segment', async () => {
    const lut = await computeMotionLut({
      input: clipPath,
      fps: 30,
      lutSize: 32,
    });

    expect(lut).toHaveLength(32);
    expect(lut[0]).toBe(0.0);
    expect(lut[31]).toBe(1.0);

    // Verify monotonic non-decreasing
    for (let i = 1; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }

    // Calculate local slope (dy/ds) in static segment vs high-motion segment:
    // In static segment (around index 8..12), slope is compressed/flat
    // In high-motion segment (around index 20..30), slope is expanded/steep
    const dyStatic = (lut[12] - lut[6]) / 6;
    const dyMotion = (lut[31] - lut[25]) / 6;

    // Slope during motion segment must be substantially steeper than static segment
    expect(dyMotion).toBeGreaterThan(dyStatic * 5);

    // Emit SVG plot of the two-speed Motion LUT curve to documentation/motion-lut-curve.svg
    const docDir = path.resolve('documentation');
    fs.mkdirSync(docDir, { recursive: true });
    const svgWidth = 640;
    const svgHeight = 420;
    const padL = 60, padR = 30, padT = 40, padB = 55;
    const plotW = svgWidth - padL - padR;
    const plotH = svgHeight - padT - padB;

    const toX = (s: number) => Math.round((padL + s * plotW) * 10) / 10;
    const toY = (y: number) => Math.round((padT + (1 - y) * plotH) * 10) / 10;

    const lutPoints = lut
      .map((y, idx) => `${toX(idx / (lut.length - 1))},${toY(y)}`)
      .join(' ');

    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="background:#0d1117;font-family:system-ui,-apple-system,sans-serif;">
  <text x="${svgWidth / 2}" y="24" fill="#e6edf3" font-size="14" font-weight="600" text-anchor="middle">Heuristic Motion-LUT Curve vs Linear Identity (Two-Speed Clip: Static 0–1s, High Motion 1–2s)</text>
  <!-- Grid & Axes -->
  <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#161b22" stroke="#30363d" stroke-width="1"/>
  <line x1="${toX(0.5)}" y1="${padT}" x2="${toX(0.5)}" y2="${padT + plotH}" stroke="#30363d" stroke-dasharray="4,4"/>
  <line x1="${padL}" y1="${toY(0.5)}" x2="${padL + plotW}" y2="${toY(0.5)}" stroke="#30363d" stroke-dasharray="4,4"/>
  <!-- Linear Identity Diagonal -->
  <line x1="${toX(0)}" y1="${toY(0)}" x2="${toX(1)}" y2="${toY(1)}" stroke="#8b949e" stroke-width="2" stroke-dasharray="6,4"/>
  <!-- Heuristic Motion LUT Curve -->
  <polyline fill="none" stroke="#58a6ff" stroke-width="3" points="${lutPoints}"/>
  ${lut.map((y, idx) => `<circle cx="${toX(idx / (lut.length - 1))}" cy="${toY(y)}" r="2.8" fill="#79c0ff"/>`).join('\n  ')}
  <!-- Annotations -->
  <text x="${toX(0.18)}" y="${toY(lut[5]) - 12}" fill="#79c0ff" font-size="11">Static Segment (0.0s–1.0s): slope dy/ds = ${dyStatic.toFixed(4)}</text>
  <text x="${toX(0.55)}" y="${toY(0.75)}" fill="#79c0ff" font-size="11">High-Motion Segment (1.0s–2.0s): slope dy/ds = ${dyMotion.toFixed(4)}</text>
  <!-- Legend -->
  <line x1="${padL + 15}" y1="${padT + 20}" x2="${padL + 40}" y2="${padT + 20}" stroke="#58a6ff" stroke-width="3"/>
  <text x="${padL + 48}" y="${padT + 24}" fill="#e6edf3" font-size="11">Motion LUT y(s) (N=${lut.length})</text>
  <line x1="${padL + 15}" y1="${padT + 38}" x2="${padL + 40}" y2="${padT + 38}" stroke="#8b949e" stroke-width="2" stroke-dasharray="6,4"/>
  <text x="${padL + 48}" y="${padT + 42}" fill="#8b949e" font-size="11">Linear Identity y = s</text>
  <!-- Axis Labels -->
  <text x="${padL + plotW / 2}" y="${svgHeight - 14}" fill="#c9d1d9" font-size="12" text-anchor="middle">Normalized Scroll Progress (s ∈ [0, 1])</text>
  <text x="18" y="${padT + plotH / 2}" fill="#c9d1d9" font-size="12" text-anchor="middle" transform="rotate(-90, 18, ${padT + plotH / 2})">Normalized Timeline Progress (y ∈ [0, 1])</text>
  <text x="${padL}" y="${padT + plotH + 18}" fill="#8b949e" font-size="11" text-anchor="middle">0.0</text>
  <text x="${toX(0.5)}" y="${padT + plotH + 18}" fill="#8b949e" font-size="11" text-anchor="middle">0.5</text>
  <text x="${toX(1.0)}" y="${padT + plotH + 18}" fill="#8b949e" font-size="11" text-anchor="middle">1.0</text>
  <text x="${padL - 8}" y="${toY(0) + 4}" fill="#8b949e" font-size="11" text-anchor="end">0.0</text>
  <text x="${padL - 8}" y="${toY(0.5) + 4}" fill="#8b949e" font-size="11" text-anchor="end">0.5</text>
  <text x="${padL - 8}" y="${toY(1) + 4}" fill="#8b949e" font-size="11" text-anchor="end">1.0</text>
</svg>`;
    const svgOutPath = path.join(docDir, 'motion-lut-curve.svg');
    fs.writeFileSync(svgOutPath, svgContent, 'utf8');
    expect(fs.existsSync(svgOutPath)).toBe(true);
  });

  it('embeds motion.lut into manifest when compiled with --motion-lut auto', async () => {
    const manifest = await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      motionLut: 'auto',
      force: true,
    });

    expect(manifest.motion?.lut).toBeDefined();
    expect(manifest.motion!.lut!.length).toBeGreaterThanOrEqual(2);
    expect(manifest.motion!.lut![0]).toBe(0);
    expect(manifest.motion!.lut![manifest.motion!.lut!.length - 1]).toBe(1);
  });
});
