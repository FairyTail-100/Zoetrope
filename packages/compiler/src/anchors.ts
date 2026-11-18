import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { AnchorSet, ImageMimeType } from '@zoetropejs/manifest';
import { findFFmpegBinary } from './ffmpeg.js';
import { jpegQualityToQscale, resolveEncoderQuality } from './compiler.js';

export interface GenerateAnchorsOptions {
  input: string;
  outputDir: string;
  sourceWidth: number;
  sourceHeight: number;
  step: number; // e.g. 10
  fps: number;
  format?: 'webp' | 'avif' | 'jpeg';
  quality?: number;
  start?: string | number;
  end?: string | number;
  signal?: AbortSignal;
}

function parseTimeSeconds(val: string | number | undefined): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  if (typeof val === 'string') {
    if (val.includes(':')) {
      const parts = val.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
    }
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

export async function generateAnchorSet(options: GenerateAnchorsOptions): Promise<AnchorSet> {
  const binary = findFFmpegBinary();
  const format = options.format ?? 'webp';
  const ext = format === 'jpeg' ? 'jpg' : format;
  const mimeType: ImageMimeType = `image/${format === 'jpeg' ? 'jpeg' : format}` as ImageMimeType;

  // 1/4 resolution, rounded to even
  const anchorW = Math.max(2, Math.floor(options.sourceWidth / 4 / 2) * 2);
  const anchorH = Math.max(2, Math.floor(options.sourceHeight / 4 / 2) * 2);

  const anchorDir = path.join(options.outputDir, 'anchors');
  fs.mkdirSync(anchorDir, { recursive: true });

  // Use select filter to pick every Nth frame
  // e.g. "select=not(mod(n\,10)),scale=480:270"
  const vf = `fps=${options.fps},select=not(mod(n\\,${options.step})),scale=${anchorW}:${anchorH}:flags=bilinear`;

  const outputPattern = path.join(anchorDir, `anchor_%04d.${ext}`);

  const startSec = parseTimeSeconds(options.start) ?? 0;
  const endSec = parseTimeSeconds(options.end);

  const args: string[] = ['-y', '-hide_banner', '-nostdin'];
  if (options.start !== undefined && options.start !== null) {
    args.push('-ss', String(options.start));
  }
  if (endSec !== undefined && endSec > startSec) {
    args.push('-t', String(endSec - startSec));
  }
  args.push('-i', options.input, '-an', '-vf', vf, '-vsync', '0');

  const resolvedQuality = resolveEncoderQuality(format, options.quality);
  if (format === 'webp') {
    args.push('-c:v', 'libwebp', '-q:v', String(resolvedQuality));
  } else if (format === 'avif') {
    args.push('-c:v', 'libaom-av1', '-crf', String(resolvedQuality), '-b:v', '0');
  } else if (format === 'jpeg') {
    args.push('-c:v', 'mjpeg', '-q:v', jpegQualityToQscale(resolvedQuality));
  }

  args.push(outputPattern);

  const proc = spawn(binary, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  const recentStderrLines: string[] = [];
  let watchdogTimer: NodeJS.Timeout | null = null;

  const exitCode = await new Promise<number>((resolve, reject) => {
    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch { /* process already exited before watchdog kill */ }
        const tail = recentStderrLines.slice(-20).join('\n');
        reject(new Error(`FFmpeg anchor generation stalled: 30s watchdog triggered without progress. Stderr tail:\n${tail}`));
      }, 30000);
    };

    resetWatchdog();

    proc.stderr.on('data', (d: Buffer) => {
      resetWatchdog();
      const text = d.toString();
      stderr += text;
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) {
          recentStderrLines.push(line.trim());
          if (recentStderrLines.length > 50) recentStderrLines.shift();
        }
      }
    });

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        try {
          proc.kill('SIGKILL');
        } catch { /* process already exited before watchdog kill */ }
        reject(new Error('Anchor generation aborted'));
      });
    }

    proc.on('close', (code) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      resolve(code ?? 0);
    });
    proc.on('error', (err) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      reject(err);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`Failed to generate anchor frames (FFmpeg exit code ${exitCode}):\n${stderr}`);
  }

  // Scan output anchors directory
  const files = fs.readdirSync(anchorDir)
    .filter((f) => f.startsWith('anchor_') && f.endsWith(`.${ext}`))
    .sort();

  const frames = files.map((f, i) => {
    const filePath = path.join(anchorDir, f);
    const stat = fs.statSync(filePath);
    return {
      frameId: i * options.step,
      src: `anchors/${f}`,
      byteLength: stat.size,
    };
  });

  return {
    step: options.step,
    width: anchorW,
    height: anchorH,
    format: mimeType,
    frames,
  };
}
