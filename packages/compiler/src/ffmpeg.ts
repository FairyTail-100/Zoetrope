import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { ExtractionResult } from './types.js';

const require = createRequire(import.meta.url);

/**
 * Portable FFmpeg binary discovery:
 * 1. process.env.CE_FFMPEG (explicit custom path)
 * 2. Optional 'ffmpeg-static' package if installed in node_modules
 * 3. System PATH (standard 'ffmpeg')
 */
export function findFFmpegBinary(): string {
  // 1. Explicit environment variable
  if (process.env.CE_FFMPEG) {
    return process.env.CE_FFMPEG;
  }

  // 2. Try ffmpeg-static if present
  try {
    const ffmpegStatic = require('ffmpeg-static') as string;
    if (ffmpegStatic && typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // Optional dependency not installed or failed to resolve
  }

  // 3. System PATH fallback
  return 'ffmpeg';
}

export function runFFmpeg(args: string[]): Promise<string> {
  const binary = findFFmpegBinary();

  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout || stderr);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr}`));
      }
    });

    proc.on('error', (err: Error) => {
      if ((err as any).code === 'ENOENT') {
        reject(
          new Error(
            `FFmpeg binary not found ('${binary}'). Please install ffmpeg on your system PATH, install 'ffmpeg-static', or set the CE_FFMPEG environment variable to your ffmpeg executable.`
          )
        );
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Extracts frames from a video file into a target directory.
 */
export async function extractVideoFrames(
  videoPath: string,
  outputDir: string,
  options?: {
    fps?: number;
    width?: number;
    height?: number;
    quality?: number;
    format?: 'webp' | 'jpg' | 'png';
  }
): Promise<ExtractionResult> {
  fs.mkdirSync(outputDir, { recursive: true });

  const fps = options?.fps ?? 30;
  const format = options?.format ?? 'webp';

  const outputPattern = path.join(outputDir, `frame_%04d.${format}`);

  const vfFilters: string[] = [];
  if (options?.width && options?.height) {
    vfFilters.push(`scale=${options.width}:${options.height}:flags=lanczos`);
  }
  vfFilters.push(`fps=${fps}`);

  const args: string[] = [
    '-y',
    '-i',
    videoPath,
    '-vf',
    vfFilters.join(','),
  ];

  if (format === 'webp') {
    args.push('-c:v', 'libwebp', '-lossless', '0', '-q:v', `${options?.quality ?? 80}`);
  } else if (format === 'jpg') {
    args.push('-qscale:v', '2');
  }

  args.push(outputPattern);

  await runFFmpeg(args);

  // Read extracted files
  const files = fs
    .readdirSync(outputDir)
    .filter((f: string) => f.startsWith('frame_') && f.endsWith(`.${format}`))
    .sort();

  return {
    framesCount: files.length,
    duration: files.length / fps,
    width: options?.width ?? 1920,
    height: options?.height ?? 1080,
    frameFiles: files.map((f: string) => path.join(outputDir, f)),
  };
}
