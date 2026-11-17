import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec, spawn } from 'node:child_process';
import { compile } from '../packages/compiler/src/compiler.js';
import { computeBuildHash, checkBuildCache } from '../packages/compiler/src/cache.js';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
Zoetrope Demo Video Runner

USAGE:
  pnpm demo:video <path-to-video.mp4> [options]

OPTIONS:
  --start <sec>   Start offset in seconds
  --end <sec>     End offset in seconds
  --fps <n>       Target framerate (default: 24)
  --force         Force re-compilation ignoring cache
`);
    process.exit(0);
  }
  let inputVideo = '';
  let start: number | undefined;
  let end: number | undefined;
  let fps = 24;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--start' && i + 1 < argv.length) {
      start = parseFloat(argv[++i]);
    } else if (arg === '--end' && i + 1 < argv.length) {
      end = parseFloat(argv[++i]);
    } else if (arg === '--fps' && i + 1 < argv.length) {
      fps = parseInt(argv[++i], 10);
    } else if (arg === '--force') {
      force = true;
    } else if (!arg.startsWith('-') && !inputVideo) {
      inputVideo = arg;
    }
  }

  if (!inputVideo) {
    console.error('\n❌ Error: Missing input video path.');
    console.error('Usage: pnpm demo:video <path-to-video.mp4> [--start <sec>] [--end <sec>] [--fps <n>] [--force]\n');
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputVideo);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`\n❌ Error: Input video file not found at: ${resolvedInput}\n`);
    process.exit(1);
  }

  const compileOptions = {
    format: 'webp' as const,
    quality: 80,
    fps,
    start,
    end,
    anchors: 10,
    variants: [
      { id: 'desktop', width: 1920, height: 1080, minWidth: 768 },
      { id: 'mobile', width: 960, height: 540, minWidth: 0, maxWidth: 767 },
    ],
    checksum: true,
  };

  const fullHash = computeBuildHash(resolvedInput, compileOptions);
  const hash = fullHash.slice(0, 12);
  const targetOutDir = path.resolve('.artifacts/custom', hash);

  console.log(`\n======================================================`);
  console.log(`🎬 ZOETROPE: CUSTOM VIDEO COMPILATION`);
  console.log(`======================================================`);
  console.log(`Source Video:   ${resolvedInput}`);
  console.log(`Output Target:  ${targetOutDir}`);
  console.log(`Build Hash:     ${hash}`);
  console.log(`Frame Rate:     ${fps} fps`);
  if (start !== undefined || end !== undefined) {
    console.log(`Time Range:     ${start ?? 0}s to ${end ?? 'end'}s`);
  }
  console.log(`Variants:       Desktop (1920x1080) + Mobile (960x540)`);
  console.log(`Anchors:        1/4 resolution (step=10)`);
  console.log(`------------------------------------------------------`);

  let manifest;
  const cached = checkBuildCache(targetOutDir, fullHash);
  if (cached && !force) {
    console.log('up to date, skipped compile');
    manifest = cached;
  } else {
    manifest = await compile({
      input: resolvedInput,
      outputDir: targetOutDir,
      ...compileOptions,
      force,
      onProgress: (p) => {
        if (p.stage === 'extracting') {
          if (p.total && p.total > 0) {
            process.stdout.write(`\rFrames Extracted: ${p.frame || 0}/${p.total} (${p.percent || 0}%)`);
          } else if (p.frame !== undefined) {
            process.stdout.write(`\rFrames Extracted: ${p.frame}`);
          }
        }
      },
    });
    console.log(`\n\n✅ Video compilation complete! Total frames: ${manifest.metadata.totalFrames}`);
  }

  // Prune older compiled sequences: keep latest N=2 builds
  const customBaseDir = path.resolve('.artifacts/custom');
  if (fs.existsSync(customBaseDir)) {
    const dirs = fs.readdirSync(customBaseDir)
      .map((name) => {
        const full = path.join(customBaseDir, name);
        try {
          return { name, path: full, stat: fs.statSync(full) };
        } catch {
          return null;
        }
      })
      .filter((d): d is { name: string; path: string; stat: fs.Stats } => d !== null && d.stat.isDirectory())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (dirs.length > 2) {
      for (const old of dirs.slice(2)) {
        console.log(`Pruning older sequence: ${old.path}`);
        try {
          fs.rmSync(old.path, { recursive: true, force: true });
        } catch {}
      }
    }
  }

  const manifestRelUrl = `/artifacts-custom/${hash}/manifest.json`;
  const demoUrl = `http://localhost:5173/?manifest=${encodeURIComponent(manifestRelUrl)}`;
  console.log(`🌐 Interactive demo target: ${demoUrl}`);

  // In non-CI environments, launch dev server and browser
  if (!process.env.CI) {
    const devProcess =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'pnpm', '--filter', 'example-basic-scroll', 'dev'], {
            stdio: 'ignore',
            detached: true,
          })
        : spawn('pnpm', ['--filter', 'example-basic-scroll', 'dev'], {
            stdio: 'ignore',
            detached: true,
          });
    devProcess.unref();

    setTimeout(() => {
      const startCmd =
        process.platform === 'win32'
          ? `start "" "${demoUrl}"`
          : process.platform === 'darwin'
          ? `open "${demoUrl}"`
          : `xdg-open "${demoUrl}"`;
      try {
        exec(startCmd);
      } catch {}
      console.log(`Press Ctrl+C to stop or exit.`);
    }, 1500);
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal compilation error:', err);
  process.exit(1);
});
