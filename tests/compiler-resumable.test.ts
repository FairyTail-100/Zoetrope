import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compile } from '../packages/compiler/src/compiler.js';
import { computeBuildHash } from '../packages/compiler/src/cache.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

function getRunningFfmpegPids(): number[] {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Get-Process ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id'],
        { encoding: 'utf8' }
      );
      return out
        .split(/\r?\n/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
    } else {
      const out = execFileSync('pgrep', ['-f', 'ffmpeg'], { encoding: 'utf8' });
      return out
        .split(/\r?\n/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
    }
  } catch {
    return [];
  }
}

describe('Phase 2 (F6): Atomic & Cache-Skipping Builds, Determinism, Process Cleanup & CLI Exit Codes', () => {
  const testDir = path.resolve('tests/fixtures/resumable-test');
  const clipPath = path.join(testDir, 'input.mp4');
  const outDir = path.join(testDir, 'out');

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=0.4:size=320x240:rate=30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      clipPath,
    ]);
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. first build creates manifest and .build-cache.json', async () => {
    const manifest = await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      force: true,
    });

    expect(manifest.metadata.totalFrames).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, '.build-cache.json'))).toBe(true);
  });

  it('2. second build with identical inputs is a cache-skipping no-op finishing in <1s', async () => {
    const t0 = performance.now();
    let hitMessage = '';
    const manifest = await compile({
      input: clipPath,
      outputDir: outDir,
      fps: 30,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      force: false,
      onProgress: (p) => {
        if (p.stage === 'complete') {
          hitMessage = p.message || '';
        }
      },
    });
    const elapsedMs = performance.now() - t0;

    expect(manifest.metadata.totalFrames).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(1000);
    expect(hitMessage).toContain('cache hit');
  });

  it('3. full-file SHA-256 cache key: changing 1 byte mid-file in a >2.5MB file invalidates the cache', () => {
    const bigFile = path.join(testDir, 'big-video.bin');
    // Create a 3 MB buffer so the middle byte at 1.5 MB is outside any 1 MB head/tail sample
    const size = 3 * 1024 * 1024;
    const buf = Buffer.alloc(size, 0x42);
    fs.writeFileSync(bigFile, buf);

    const opts = { fps: 30, format: 'webp' };
    const hashBefore = computeBuildHash(bigFile, opts);

    // Flip 1 byte right in the middle (offset 1.5 MB)
    buf[Math.floor(size / 2)] = 0x99;
    fs.writeFileSync(bigFile, buf);

    const hashAfter = computeBuildHash(bigFile, opts);
    expect(hashAfter).not.toBe(hashBefore);
  });

  it('4. determinism: same input + options produces a byte-identical manifest.json twice', async () => {
    const outDet1 = path.join(testDir, 'det-1');
    const outDet2 = path.join(testDir, 'det-2');

    const commonOpts = {
      input: clipPath,
      id: 'deterministic-id',
      fps: 30,
      format: 'webp' as const,
      quality: 80,
      checksum: true,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      force: true,
    };

    await compile({ ...commonOpts, outputDir: outDet1 });
    await compile({ ...commonOpts, outputDir: outDet2 });

    const manifestBytes1 = fs.readFileSync(path.join(outDet1, 'manifest.json'));
    const manifestBytes2 = fs.readFileSync(path.join(outDet2, 'manifest.json'));

    expect(manifestBytes1.equals(manifestBytes2)).toBe(true);
  });

  it('5. cancelling with AbortSignal leaves no orphaned ffmpeg processes and no partial output', async () => {
    const abortOutDir = path.join(testDir, 'abort-out');
    const pidsBefore = new Set(getRunningFfmpegPids());
    const controller = new AbortController();

    const compilePromise = compile({
      input: clipPath,
      outputDir: abortOutDir,
      fps: 30,
      variants: [{ id: 'desktop', width: 320, height: 240, minWidth: 0 }],
      force: true,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.stage === 'extracting') {
          controller.abort();
        }
      },
    });

    await expect(compilePromise).rejects.toThrow();

    // Give OS up to 500ms to reap killed process handles on Windows
    let pidsAfter: number[] = [];
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 50));
      pidsAfter = getRunningFfmpegPids().filter((pid) => !pidsBefore.has(pid));
      if (pidsAfter.length === 0) break;
    }
    expect(pidsAfter).toHaveLength(0);

    // Verify no temporary .tmp-* directories or partial manifest.json remain in abortOutDir
    if (fs.existsSync(abortOutDir)) {
      const leftoverTmp = fs.readdirSync(abortOutDir).filter((f) => f.startsWith('.tmp-'));
      expect(leftoverTmp).toHaveLength(0);
      expect(fs.existsSync(path.join(abortOutDir, 'manifest.json'))).toBe(false);
    }
  });

  it('6. CLI exit codes: 0 on success, 1 on validation failure, 1 on bad input, non-zero on SIGTERM abort', async () => {
    const cliScript = path.resolve('packages/compiler/src/cli.ts');
    const cliOutDir = path.join(testDir, 'cli-out');

    const runCli = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        const proc = spawn(process.execPath, ['--import', 'tsx', cliScript, ...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => (stdout += d.toString()));
        proc.stderr.on('data', (d) => (stderr += d.toString()));
        proc.on('close', (code) => resolve({ code, stdout, stderr }));
      });

    // (a) Success -> exit code 0
    const resSuccess = await runCli([
      'compile',
      clipPath,
      '--out',
      cliOutDir,
      '--variant',
      'desktop:320:240:0',
      '--checksum',
      '--force',
    ]);
    expect(resSuccess.code).toBe(0);

    // (b) Validation success -> exit code 0
    const manifestPath = path.join(cliOutDir, 'manifest.json');
    const resValOk = await runCli(['validate', manifestPath, '--deep', '--json']);
    expect(resValOk.code).toBe(0);

    // (c) Validation failure (corrupt frame bytes -> checksum mismatch) -> exit code 1
    const frame1Path = path.join(cliOutDir, 'desktop', 'frame_0001.webp');
    const origFrame = fs.readFileSync(frame1Path);
    const corrupted = Buffer.from(origFrame);
    corrupted[corrupted.length - 1] ^= 0xff;
    fs.writeFileSync(frame1Path, corrupted);

    const resValFail = await runCli(['validate', manifestPath, '--json']);
    expect(resValFail.code).toBe(1);
    expect(resValFail.stdout).toContain('CHECKSUM_MISMATCH');

    // Restore frame
    fs.writeFileSync(frame1Path, origFrame);

    // (d) Bad input (nonexistent file) -> exit code 1
    const resBadInput = await runCli(['compile', path.join(testDir, 'missing.mp4'), '--out', cliOutDir]);
    expect(resBadInput.code).toBe(1);

    // (e) Abort via process termination -> non-zero exit code & no leftover .tmp-*
    const sigOutDir = path.join(testDir, 'cli-sig-out');
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx', cliScript, 'compile', clipPath, '--out', sigOutDir, '--force'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    const abortCode = await new Promise<number | null>((resolve) => {
      proc.stdout.on('data', (d) => {
        if (d.toString().includes('ZoetropeJS Compiler')) {
          proc.kill('SIGTERM');
        }
      });
      proc.on('close', (code) => resolve(code));
    });
    expect(abortCode).not.toBe(0);
    if (fs.existsSync(sigOutDir)) {
      const tmpLeft = fs.readdirSync(sigOutDir).filter((f) => f.startsWith('.tmp-'));
      expect(tmpLeft).toHaveLength(0);
    }
  }, 20000);
});
