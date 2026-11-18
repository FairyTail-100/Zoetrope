#!/usr/bin/env node
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, VariantDefinition } from './compiler.js';
import { probeMedia } from './probe.js';
import { validateManifestFile, ValidationResult } from './validator.js';
import { runDoctor, printDoctorTable } from './doctor.js';

function printHelp(): void {
  console.log(`
ZoetropeJS — Asset Compiler & Validator

USAGE:
  zoetropejs  <input-video> --out <output-dir> [options]
  zoetropejs  <manifest-path> [--deep] [--json]
  zoetropejs 

COMMANDS:
  compile <input>         Extracts and packages video into Zoetrope scroll variants
  validate <manifest>     Validates manifest schema, file continuity, byte sizes, and checksums
  doctor                  Checks system requirements (Node, pnpm, FFmpeg, disk space)

COMPILE OPTIONS:
  --out <dir>             Output directory for manifest and frames (required)
  --id <string>           Unique animation sequence ID (default: input basename)
  --variant <spec>        Define variant as "id:width:height:minWidth" (can specify multiple)
                          Default: desktop:1920:1080:768 and mobile:640:360:0
  --format <fmt>          Image format: webp | avif | jpeg (default: webp)
  --formats <list>        Comma-separated format list (e.g. avif,webp)
  --quality <0-100>       Compression quality (default: 80 for webp, CRF 32 for avif, 85 for jpeg; higher is better for webp/jpeg, lower is better for avif CRF)
  --desktop-width <n>     Desktop variant target width in pixels (default: 1920)
  --mobile-width <n>      Mobile variant target width in pixels (default: 640)
  --fps <n>               Target frame rate (default: video source fps)
  --step <n>              Frame sampling step (default: 1)
  --start <timestamp>     Start time in video (e.g. "00:00:02" or "2.5")
  --end <timestamp>       End time in video
  --packing <mode>        individual | chunked | range (default: individual)
  --chunk-size <n>        Frames per chunk when packing=chunked (default: 24)
  --fit <cover|contain>   Aspect ratio fit mode (default: cover)
  --checksum              Compute and embed SHA-256 checksums
  --anchors <step>        Generate 1/4 resolution anchor frames every N frames (e.g. 10)
  --motion-lut <mode>     "auto" (heuristic motion-stretch) | "linear" | <path-to-json>
  --force                 Ignore build cache and recompile all frames

VALIDATE OPTIONS:
  --deep                  Deep validation: parses image headers to verify dimensions and integrity
  --json                  Output validation results as structured JSON

EXAMPLES:
  zoetropejs  clip.mp4 --out ./public/assets/clip --fps 30 --checksum
  zoetropejs  clip.mp4 --out ./dist --variant desktop:1920:1080:768 --variant mobile:640:360:0 --anchors 10
  zoetropejs  ./public/assets/clip/manifest.json --deep
`);
}

export interface ParsedCliArgs {
  command?: string;
  inputPath?: string;
  outDir?: string;
  format?: 'webp' | 'avif' | 'jpeg';
  formats?: Array<'webp' | 'avif' | 'jpeg'>;
  packing?: 'individual' | 'chunked' | 'range';
  chunkSize?: number;
  quality?: number;
  desktopWidth?: number;
  mobileWidth?: number;
  fps?: number;
  step?: number;
  start?: string;
  end?: string;
  fit?: 'cover' | 'contain';
  checksum?: boolean;
  anchors?: number;
  motionLut?: string;
  force?: boolean;
  id?: string;
  autoYes?: boolean;
  variants: VariantDefinition[];
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  const command = args[0];
  let inputPath = command === 'compile' ? args[1] : undefined;
  const remainingArgs = command === 'compile' ? args.slice(2) : args;

  const getArg = (flag: string): string | undefined => {
    const idx = remainingArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < remainingArgs.length ? remainingArgs[idx + 1] : undefined;
  };
  const hasFlag = (flag: string): boolean => remainingArgs.includes(flag);

  if (!inputPath) {
    inputPath = getArg('--input');
  }

  const outDir = getArg('--out') ?? getArg('--output');

  const variants: VariantDefinition[] = [];
  for (let i = 0; i < remainingArgs.length; i++) {
    if (remainingArgs[i] === '--variant' && i + 1 < remainingArgs.length) {
      const spec = remainingArgs[i + 1];
      const parts = spec.split(':');
      if (parts.length >= 3) {
        variants.push({
          id: parts[0],
          width: parseInt(parts[1], 10),
          height: parseInt(parts[2], 10),
          minWidth: parts[3] ? parseInt(parts[3], 10) : 0,
        });
      }
    }
  }

  const format = (getArg('--format') as any) ?? 'webp';
  const formatsArg = getArg('--formats');
  const formats = formatsArg ? (formatsArg.split(',').map((f) => f.trim()) as any) : undefined;
  const quality = getArg('--quality') ? parseInt(getArg('--quality')!, 10) : undefined;
  const desktopWidth = getArg('--desktop-width') ? parseInt(getArg('--desktop-width')!, 10) : undefined;
  const mobileWidth = getArg('--mobile-width') ? parseInt(getArg('--mobile-width')!, 10) : undefined;
  const fps = getArg('--fps') ? parseFloat(getArg('--fps')!) : undefined;
  const step = getArg('--step') ? parseInt(getArg('--step')!, 10) : 1;
  const start = getArg('--start');
  const end = getArg('--end');
  const packing = (getArg('--packing') as any) ?? 'individual';
  const chunkSize = getArg('--chunk-size') ? parseInt(getArg('--chunk-size')!, 10) : 24;
  const fit = (getArg('--fit') as any) ?? 'cover';
  const checksum = hasFlag('--checksum');
  const anchors = getArg('--anchors') ? parseInt(getArg('--anchors')!, 10) : undefined;
  const motionLut = getArg('--motion-lut') ?? (hasFlag('--motion-lut') ? 'auto' : undefined);
  const force = hasFlag('--force');
  const id = getArg('--id');
  const autoYes = hasFlag('--yes') || hasFlag('-y');

  return {
    command,
    inputPath,
    outDir,
    format,
    formats,
    quality,
    desktopWidth,
    mobileWidth,
    fps,
    step,
    start,
    end,
    packing,
    chunkSize,
    fit,
    checksum,
    anchors,
    motionLut,
    force,
    id,
    autoYes,
    variants,
  };
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const parsed = parseCliArgs(args);
  const command = parsed.command;

  if (command === 'doctor') {
    const summary = runDoctor();
    printDoctorTable(summary);
    process.exit(summary.allOk ? 0 : 1);
  }

  if (command === 'init') {
    const inputPath = args[1];
    const outIdx = args.indexOf('--out');
    const outDir = (outIdx !== -1 && outIdx + 1 < args.length ? args[outIdx + 1] : undefined) ?? './dist-zoetrope';

    console.log(`\n🚀 Initializing Zoetrope sequence...`);
    if (inputPath && fs.existsSync(inputPath)) {
      console.log(`📹 Compiling video footage: ${inputPath}`);
      console.log(`   - Desktop: 1920x1080 (minWidth 768)`);
      console.log(`   - Mobile:  640x360 (minWidth 0)`);
      console.log(`   - Format:  WebP (Q=80, anchors step=10)`);

      await compile({
        input: inputPath,
        outputDir: outDir,
        format: 'webp',
        quality: 80,
        anchors: 10,
        variants: [
          { id: 'desktop', width: 1920, height: 1080, minWidth: 768 },
          { id: 'mobile', width: 640, height: 360, minWidth: 0 },
        ],
        checksum: true,
      });
    }

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const snippet = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zoetrope Embed</title>
  <style>
    body { margin: 0; background: #000; overflow-x: hidden; }
    .scroll-container { height: 300vh; position: relative; }
    canvas { position: sticky; top: 0; width: 100vw; height: 100vh; display: block; }
  </style>
</head>
<body>
  <div class="scroll-container">
    <canvas id="zoetrope-canvas"></canvas>
  </div>

  <script type="module">
    import { Zoetrope } from '@zoetropejs/core';

    const engine = new Zoetrope({
      canvas: document.getElementById('zoetrope-canvas'),
      manifest: './manifest.json',
      playback: { mode: 'scroll', container: window },
      renderer: { fit: 'cover' },
    });

    await engine.init();
    console.log('Zoetrope Ready!');
  </script>
</body>
</html>
`;

    const snippetPath = path.join(outDir, 'zoetrope-embed.html');
    fs.writeFileSync(snippetPath, snippet, 'utf8');

    console.log(`\n✨ Zoetrope project initialized successfully!`);
    console.log(`📁 Assets & manifest: ${outDir}/manifest.json`);
    console.log(`📄 Embed snippet:     ${snippetPath}`);
    console.log(`\nTo run: drop the 5-line script into your page or open ${snippetPath} in a local server.\n`);
    process.exit(0);
  }

  if (command === 'validate') {
    const manifestPath = args[1];
    if (!manifestPath || manifestPath.startsWith('--')) {
      console.error('Error: Missing required <manifest-path> for validate command.');
      process.exit(1);
    }

    const deep = args.includes('--deep');
    const isJson = args.includes('--json');

    const result: ValidationResult = await validateManifestFile(manifestPath, { deep });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n======================================================');
      console.log(`📋 ZOETROPE MANIFEST VALIDATION: ${path.basename(manifestPath)}`);
      console.log('======================================================');
      console.log(`Status:            ${result.valid ? '✅ VALID' : '❌ INVALID'}`);
      console.log(`Deep Checked:      ${result.deepValidated ? 'Yes' : 'No'}`);
      console.log(`Variants Checked:  ${result.checkedVariants}`);
      console.log(`Frames Checked:    ${result.checkedFrames}`);

      if (result.errors.length > 0) {
        console.log('\n❌ Errors:');
        for (const err of result.errors) {
          console.log(`  - [${err.code}] ${err.message}${err.filePath ? ` (${err.filePath})` : ''}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log('\n⚠️ Warnings:');
        for (const w of result.warnings) {
          console.log(`  - ${w}`);
        }
      }
      console.log('======================================================\n');
    }

    process.exit(result.valid ? 0 : 1);
  }

  const {
    inputPath,
    outDir,
    variants,
    format,
    formats,
    quality,
    desktopWidth,
    mobileWidth,
    fps,
    step,
    start,
    end,
    packing,
    chunkSize,
    fit,
    checksum,
    anchors,
    motionLut,
    force,
    id,
    autoYes,
  } = parsed;

  if (!inputPath || !outDir) {
    console.error('Error: Both <input> and --out <dir> are required.');
    printHelp();
    process.exit(1);
  }

  console.log(`\n🎬 ZoetropeJS Compiler`);
  console.log(`Input:   ${inputPath}`);
  console.log(`Output:  ${outDir}`);
  console.log(`Packing: ${packing}`);
  console.log(`Format:  ${format}`);

  const defaultDesktopW = desktopWidth ?? 1920;
  const defaultDesktopH = Math.round((defaultDesktopW * 9) / 16);
  const defaultMobileW = mobileWidth ?? 640;
  const defaultMobileH = Math.round((defaultMobileW * 9) / 16);

  const activeVariants = variants.length > 0 ? variants : [
    { id: 'desktop', width: defaultDesktopW, height: defaultDesktopH, minWidth: 768 },
    { id: 'mobile', width: defaultMobileW, height: defaultMobileH, minWidth: 0 },
  ];

  // DISK GUARD: Estimate output size before extraction
  try {
    const probe = await probeMedia(path.resolve(inputPath));
    const targetFps = fps ?? probe.fps ?? 30;
    const startSec = start ? parseFloat(start) : 0;
    const endSec = end ? parseFloat(end) : probe.duration;
    const duration = Math.max(0.1, endSec - startSec);
    const estFrames = Math.max(1, Math.floor((duration * targetFps) / (step ?? 1)));

    const bytesPerPixel = format === 'jpeg' ? 0.08 : 0.05;
    let totalEstBytes = 0;
    for (const v of activeVariants) {
      const bytesPerFrame = Math.round(v.width * v.height * bytesPerPixel);
      totalEstBytes += bytesPerFrame * estFrames;
    }

    console.log(`Estimated output: ~${(totalEstBytes / (1024 * 1024)).toFixed(1)} MB (${estFrames} frames x ${activeVariants.length} variants)`);

    let freeBytes = Infinity;
    try {
      const outParent = fs.existsSync(outDir) ? outDir : path.dirname(path.resolve(outDir));
      const s = fs.statfsSync(outParent);
      freeBytes = s.bsize * s.bavail;
    } catch { /* statfsSync unavailable; fall back to Infinity */ }

    const isExceeding500MB = totalEstBytes > 500 * 1024 * 1024;
    const isDiskTight = freeBytes < 2 * totalEstBytes;

    if ((isExceeding500MB || isDiskTight) && !autoYes) {
      console.warn(`\n⚠️  DISK GUARD: Estimated compilation size is ${(totalEstBytes / (1024 * 1024)).toFixed(1)} MB.`);
      if (isExceeding500MB) {
        console.warn(`   - Warning: Estimated output exceeds 500MB safety limit.`);
      }
      if (isDiskTight) {
        console.warn(`   - Warning: Available free disk space (${(freeBytes / (1024 * 1024)).toFixed(1)} MB) is under 2x estimate.`);
      }
      console.warn(`   - Pass --yes to confirm and proceed with compilation.\n`);
      process.exit(1);
    }
  } catch { /* best-effort disk guard; compile() handles real failures */ }

  try {
    const manifest = await compile({
      input: inputPath,
      outputDir: outDir,
      id,
      variants: (variants.length > 0 || desktopWidth !== undefined || mobileWidth !== undefined) ? activeVariants : undefined,
      format,
      formats,
      quality,
      fps,
      step,
      start,
      end,
      packing,
      chunkSize,
      fit,
      checksum,
      anchors,
      motionLut,
      force,
      onProgress: (p) => {
        const percentStr = `[${p.percent}%]`.padEnd(7);
        console.log(`  ▶ ${percentStr} ${p.message || p.stage}`);
      },
    });

    console.log(`\n✅ Compilation successful! Manifest written to: ${path.join(outDir, 'manifest.json')}`);
    console.log(`Variants: ${manifest.variants.map((v) => `${v.id} (${v.width}x${v.height})`).join(', ')}`);
    console.log(`Total Frames: ${manifest.metadata.totalFrames} (${manifest.metadata.fps} FPS, ${manifest.metadata.duration}s)\n`);
  } catch (err: any) {
    console.error(`\n❌ Compilation Error: ${err.message}\n`);
    process.exit(1);
  }
}

const isDirectCli = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('cli.ts') ||
    process.argv[1].endsWith('cli.js') ||
    process.argv[1].endsWith('zoetrope'))
);

if (isDirectCli) {
  run().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}
