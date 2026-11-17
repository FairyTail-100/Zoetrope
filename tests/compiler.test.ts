import { describe, it, expect } from 'vitest';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';
import { parseCliArgs } from '../packages/compiler/src/cli.js';
import { buildFFmpegArgs } from '../packages/compiler/src/compiler.js';

describe('FFmpeg Binary Discovery & Execution', () => {
  it('discovers and executes FFmpeg successfully', async () => {
    const versionOutput = await runFFmpeg(['-version']);
    expect(versionOutput).toContain('ffmpeg version');
  });

  it('accepts --formats avif,webp and --packing chunked in CLI argument parser', () => {
    const parsed = parseCliArgs([
      'compile',
      'input.mp4',
      '--out',
      './output',
      '--formats',
      'avif,webp',
      '--packing',
      'chunked'
    ]);

    expect(parsed.command).toBe('compile');
    expect(parsed.inputPath).toBe('input.mp4');
    expect(parsed.outDir).toBe('./output');
    expect(parsed.formats).toEqual(['avif', 'webp']);
    expect(parsed.packing).toBe('chunked');
  });

  it('accepts --quality, --desktop-width, and --mobile-width in CLI parser', () => {
    const parsed = parseCliArgs([
      'compile',
      'input.mp4',
      '--out',
      './output',
      '--quality',
      '75',
      '--desktop-width',
      '1280',
      '--mobile-width',
      '480'
    ]);

    expect(parsed.quality).toBe(75);
    expect(parsed.desktopWidth).toBe(1280);
    expect(parsed.mobileWidth).toBe(480);
  });

  it('verifies that quality and width flags reach FFmpeg args without compiling', () => {
    const argsDesktop = buildFFmpegArgs({
      input: 'sample.mp4',
      outputPattern: './out/desktop/frame_%04d.webp',
      width: 1280,
      height: 720,
      quality: 75,
      format: 'webp'
    });

    expect(argsDesktop).toContain('-q:v');
    expect(argsDesktop[argsDesktop.indexOf('-q:v') + 1]).toBe('75');
    expect(argsDesktop.join(' ')).toContain('scale=1280:720');

    const argsMobile = buildFFmpegArgs({
      input: 'sample.mp4',
      outputPattern: './out/mobile/frame_%04d.webp',
      width: 480,
      height: 270,
      quality: 60,
      format: 'webp'
    });

    expect(argsMobile).toContain('-q:v');
    expect(argsMobile[argsMobile.indexOf('-q:v') + 1]).toBe('60');
    expect(argsMobile.join(' ')).toContain('scale=480:270');
  });
});
