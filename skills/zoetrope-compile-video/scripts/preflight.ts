import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeMedia } from '../../../packages/compiler/src/probe.js';

export interface PreflightReport {
  ffmpegOk: boolean;
  input: string;
  durationSec: number;
  fps: number;
  totalFrames: number;
  estimatedDiskMb: number;
  freeDiskMb: number;
  recommendation: 'GO' | 'WARN_DISK' | 'NO_GO';
  reason?: string;
}

export async function runPreflight(inputPath: string, outputDir: string, fps = 24): Promise<PreflightReport> {
  const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  if (ffmpegCheck.status !== 0) {
    return {
      ffmpegOk: false,
      input: inputPath,
      durationSec: 0,
      fps,
      totalFrames: 0,
      estimatedDiskMb: 0,
      freeDiskMb: 0,
      recommendation: 'NO_GO',
      reason: 'ffmpeg not found in PATH'
    };
  }

  if (!fs.existsSync(inputPath)) {
    return {
      ffmpegOk: true,
      input: inputPath,
      durationSec: 0,
      fps,
      totalFrames: 0,
      estimatedDiskMb: 0,
      freeDiskMb: 0,
      recommendation: 'NO_GO',
      reason: `Input file does not exist: ${inputPath}`
    };
  }

  const probe = await probeMedia(inputPath);
  const totalFrames = Math.max(1, Math.floor(probe.duration * fps));
  // Conservative estimate: 2 variants (DESKTOP + MOBILE) @ ~60KB per WebP frame
  const estimatedBytes = totalFrames * 2 * 60 * 1024;
  const estimatedDiskMb = Math.round(estimatedBytes / (1024 * 1024));

  const targetDir = path.resolve(outputDir);
  const checkDir = fs.existsSync(targetDir) ? targetDir : path.dirname(targetDir);
  let freeDiskMb = 10000;
  try {
    const stats = fs.statfsSync(checkDir);
    freeDiskMb = Math.round((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024));
  } catch {
    // fallback if statfsSync is unsupported
  }

  let recommendation: 'GO' | 'WARN_DISK' | 'NO_GO' = 'GO';
  let reason: string | undefined;

  if (freeDiskMb < estimatedDiskMb * 2) {
    recommendation = 'WARN_DISK';
    reason = `Free disk space (${freeDiskMb}MB) is less than 2x estimated output (${estimatedDiskMb}MB). Use --yes flag to proceed.`;
  }

  return {
    ffmpegOk: true,
    input: inputPath,
    durationSec: probe.duration,
    fps,
    totalFrames,
    estimatedDiskMb,
    freeDiskMb,
    recommendation,
    reason
  };
}

if (process.argv[1] && process.argv[1].endsWith('preflight.ts')) {
  const file = process.argv[2];
  const out = process.argv[3] || './out';
  if (!file) {
    console.error('Usage: tsx preflight.ts <input-video> [output-dir]');
    process.exit(1);
  }
  runPreflight(file, out).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.recommendation === 'NO_GO') process.exit(1);
  });
}
