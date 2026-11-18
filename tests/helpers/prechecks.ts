import { spawnSync } from 'node:child_process';
import { findFFmpegBinary } from '../../packages/compiler/src/index.js';

export function requireFFmpeg(): void {
  const bin = findFFmpegBinary();
  const res = spawnSync(bin, ['-version'], { stdio: 'pipe', windowsHide: true });
  if (res.status !== 0) {
    throw new Error(
      `Missing required tool: FFmpeg (checked "${bin}"). Install FFmpeg (e.g. "winget install Gyan.FFmpeg" on Windows or "brew install ffmpeg" on macOS) and ensure it is on PATH.`
    );
  }
}

export function requireChromium(): void {
  const res = spawnSync('npx', ['playwright', 'install', '--dry-run', 'chromium'], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (res.error) {
    throw new Error(
      'Missing required tool: Playwright Chromium. Install it with "pnpm exec playwright install chromium".'
    );
  }
}
