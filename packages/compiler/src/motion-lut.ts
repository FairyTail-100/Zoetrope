import { spawn } from 'node:child_process';
import { findFFmpegBinary } from './ffmpeg.js';

export interface MotionLutOptions {
  input: string;
  fps?: number;
  start?: string;
  end?: string;
  lutSize?: number; // default 64 entries
  signal?: AbortSignal;
}

/**
 * Computes a heuristic motion-stretch LUT based on mean absolute luminance difference (MAD)
 * between consecutive frames extracted at 64x36 resolution.
 *
 * High visual motion -> higher weight -> more scroll distance (steeper slope)
 * Static / low motion -> lower weight -> compressed scroll distance (flatter slope)
 */
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

export async function computeMotionLut(options: MotionLutOptions): Promise<number[]> {
  const binary = findFFmpegBinary();
  const fps = options.fps ?? 30;
  const lutSize = options.lutSize ?? 64;

  const w = 64;
  const h = 36;
  const frameBytes = w * h; // 2304 bytes per frame

  const startSec = parseTimeSeconds(options.start) ?? 0;
  const endSec = parseTimeSeconds(options.end);

  const args: string[] = ['-hide_banner', '-nostdin'];
  if (options.start !== undefined && options.start !== null) {
    args.push('-ss', String(options.start));
  }
  if (endSec !== undefined && endSec > startSec) {
    args.push('-t', String(endSec - startSec));
  }
  args.push('-i', options.input, '-an');

  args.push(
    '-vf', `fps=${fps},scale=${w}:${h}:flags=bilinear,format=gray`,
    '-f', 'rawvideo',
    'pipe:1'
  );

  const proc = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const chunks: Buffer[] = [];
  let totalRead = 0;
  let watchdogTimer: NodeJS.Timeout | null = null;
  const recentStderrLines: string[] = [];

  const exitCode = await new Promise<number>((resolve, reject) => {
    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
        const tail = recentStderrLines.slice(-20).join('\n');
        reject(new Error(`FFmpeg motion analysis stalled: 30s watchdog triggered. Stderr tail:\n${tail}`));
      }, 30000);
    };

    resetWatchdog();

    proc.stdout.on('data', (d: Buffer) => {
      resetWatchdog();
      chunks.push(d);
      totalRead += d.length;
    });

    proc.stderr.on('data', (d: Buffer) => {
      resetWatchdog();
      const lines = d.toString().split(/\r?\n/);
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
        } catch {}
        reject(new Error('Motion LUT analysis aborted'));
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
    throw new Error(`FFmpeg motion analysis exited with code ${exitCode}`);
  }

  const buffer = Buffer.concat(chunks, totalRead);
  const totalFrames = Math.floor(buffer.length / frameBytes);

  if (totalFrames < 2) {
    // Insufficient frames to compute difference; return linear identity
    return [0, 1];
  }

  // Calculate Mean Absolute Difference (MAD) between consecutive frames
  const weights: number[] = new Array(totalFrames - 1);
  const EPSILON = 1.0; // Baseline travel weight so static frames do not stop scroll completely

  for (let f = 0; f < totalFrames - 1; f++) {
    const offsetA = f * frameBytes;
    const offsetB = (f + 1) * frameBytes;
    let sumDiff = 0;
    for (let p = 0; p < frameBytes; p++) {
      sumDiff += Math.abs(buffer[offsetA + p] - buffer[offsetB + p]);
    }
    const mad = sumDiff / frameBytes;
    weights[f] = mad + EPSILON;
  }

  // Cumulative sum
  const cumSum = new Float64Array(totalFrames);
  cumSum[0] = 0;
  for (let f = 0; f < totalFrames - 1; f++) {
    cumSum[f + 1] = cumSum[f] + weights[f];
  }

  const totalWeight = cumSum[totalFrames - 1];
  if (totalWeight <= 0) {
    return [0, 1];
  }

  // Normalize to [0, 1]
  const normalizedProgression = new Float64Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    normalizedProgression[f] = cumSum[f] / totalWeight;
  }

  // Resample monotonically to target lutSize
  const lut: number[] = new Array(lutSize);
  for (let i = 0; i < lutSize; i++) {
    const t = i / (lutSize - 1); // target video progress in [0, 1]
    // Find index in normalizedProgression where progression >= t
    let low = 0;
    let high = totalFrames - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (normalizedProgression[mid] < t) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    const idx = low;
    if (idx === 0) {
      lut[i] = 0;
    } else {
      const p0 = normalizedProgression[idx - 1];
      const p1 = normalizedProgression[idx];
      const frac = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
      const framePos = (idx - 1 + frac) / (totalFrames - 1);
      lut[i] = Math.min(1.0, Math.max(0.0, Math.round(framePos * 10000) / 10000));
    }
  }

  lut[0] = 0.0;
  lut[lutSize - 1] = 1.0;

  // Enforce monotonic non-decreasing
  for (let i = 1; i < lutSize; i++) {
    if (lut[i] < lut[i - 1]) {
      lut[i] = lut[i - 1];
    }
  }

  return lut;
}
