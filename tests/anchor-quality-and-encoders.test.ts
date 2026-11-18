import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import {
  resolveEncoderQuality,
  jpegQualityToQscale,
  parseFFmpegEncoders,
} from '../packages/compiler/src/index.js';

describe('resolveEncoderQuality', () => {
  it('uses compile defaults per format when quality is omitted', () => {
    expect(resolveEncoderQuality('webp')).toBe(80);
    expect(resolveEncoderQuality('avif')).toBe(32);
    expect(resolveEncoderQuality('jpeg')).toBe(85);
  });

  it('uses explicit quality when provided', () => {
    expect(resolveEncoderQuality('webp', 65)).toBe(65);
    expect(resolveEncoderQuality('avif', 28)).toBe(28);
    expect(resolveEncoderQuality('jpeg', 90)).toBe(90);
  });

  it('maps jpeg quality to FFmpeg qscale', () => {
    expect(jpegQualityToQscale(85)).toBe('6');
    expect(jpegQualityToQscale(100)).toBe('1');
    expect(jpegQualityToQscale(1)).toBe('31');
  });
});

describe('parseFFmpegEncoders', () => {
  it('detects libwebp, libaom-av1, and mjpeg when all are present', () => {
    const mockOutput = [
      'Encoders:',
      ' V..... = Video',
      ' ------',
      ' V..... libwebp              libwebp WebP image (codec webp)',
      ' V....D libaom-av1           libaom AV1 (codec av1)',
      ' VF...D mjpeg                MJPEG (Motion JPEG)',
    ].join('\n');

    expect(parseFFmpegEncoders(mockOutput)).toEqual({
      libwebp: true,
      'libaom-av1': true,
      mjpeg: true,
    });
  });

  it('reports missing encoders accurately', () => {
    const mockOutput = [
      'Encoders:',
      ' V..... = Video',
      ' ------',
      ' VF...D mjpeg                MJPEG (Motion JPEG)',
    ].join('\n');

    expect(parseFFmpegEncoders(mockOutput)).toEqual({
      libwebp: false,
      'libaom-av1': false,
      mjpeg: true,
    });
  });
});

describe('statfsSync disk-guard fallback', () => {
  it('does not throw when statfsSync fails', () => {
    let freeBytes = Infinity;
    try {
      const s = fs.statfsSync('Z:\\nonexistent-zoetropejs-path-12345');
      freeBytes = s.bsize * s.bavail;
    } catch { /* statfsSync unavailable; skips only the free-space check */ }
    expect(freeBytes).toBe(Infinity);
  });
});
