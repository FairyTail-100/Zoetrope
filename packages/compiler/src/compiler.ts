import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import {
  AnimationManifest,
  ImageMimeType,
  PackingMode,
  ResolutionVariant,
  validateManifest,
  VariantFormatSource,
  VariantStats,
} from '@zoetropejs/manifest';
import { packCEPK } from '@zoetropejs/streaming';
import { probeMedia } from './probe.js';
import { computeMotionLut } from './motion-lut.js';
import { generateAnchorSet } from './anchors.js';
import { checkFFmpegEncoders } from './doctor.js';
import { computeBuildHash, checkBuildCache, saveBuildCache } from './cache.js';
import { findFFmpegBinary } from './ffmpeg.js';

export interface VariantDefinition {
  id: string;
  width: number;
  height: number;
  minWidth: number;
  maxWidth?: number;
  fps?: number;
  format?: 'webp' | 'avif' | 'jpeg';
  formats?: Array<'webp' | 'avif' | 'jpeg'>;
  quality?: number;
  fit?: 'cover' | 'contain';
}

export interface CompileProgressEvent {
  stage: 'probing' | 'extracting' | 'packing' | 'motion-lut' | 'anchors' | 'checksums' | 'complete';
  percent: number;
  frame?: number;
  total?: number;
  variantId?: string;
  message?: string;
}

export interface CompileOptions {
  input: string;
  outputDir: string;
  id?: string;
  variants?: VariantDefinition[];
  format?: 'webp' | 'avif' | 'jpeg';
  formats?: Array<'webp' | 'avif' | 'jpeg'>;
  quality?: number;
  fps?: number;
  step?: number;
  start?: string | number;
  end?: string | number;
  packing?: PackingMode;
  chunkSize?: number;
  fit?: 'cover' | 'contain';
  checksum?: boolean;
  anchors?: number;
  motionLut?: 'auto' | 'linear' | string;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: CompileProgressEvent) => void;
}

async function convertPngsToAvif(
  dir: string,
  quality: number = 65,
  signal?: AbortSignal
): Promise<void> {
  let sharp: any;
  try {
    const sharpModule = await import('sharp');
    sharp = sharpModule.default || sharpModule;
    sharp.cache(false);
  } catch {
    throw new Error(
      "AVIF encoding requires the optional 'sharp' package. Please install it with 'pnpm add -D sharp' or use --format webp."
    );
  }

  const pngFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  // Convert in parallel batches of 4
  const batchSize = 4;
  for (let b = 0; b < pngFiles.length; b += batchSize) {
    if (signal?.aborted) throw new Error('Compilation aborted');
    const batch = pngFiles.slice(b, b + batchSize);
    await Promise.all(
      batch.map(async (f) => {
        const pngPath = path.join(dir, f);
        const avifPath = path.join(dir, f.replace(/\.png$/, '.avif'));
        await sharp(pngPath)
          .avif({ quality, effort: 4, chromaSubsampling: '4:2:0', bitdepth: 8 })
          .toFile(avifPath);
        fs.unlinkSync(pngPath);
      })
    );
  }
}

function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function calculateMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function jpegQualityToQscale(quality: number = 85): string {
  const clamped = Math.max(1, Math.min(100, quality));
  const qscale = Math.max(1, Math.min(31, Math.round(31 - ((clamped - 1) / 99) * 30)));
  return String(qscale);
}

export function resolveEncoderQuality(format: 'webp' | 'avif' | 'jpeg', quality?: number): number {
  if (quality !== undefined) return quality;
  if (format === 'webp') return 80;
  if (format === 'avif') return 32;
  return 85;
}

/**
 * Maps probed video color space to portable `scale` filter `in_color_matrix` names
 * accepted by FFmpeg 6.0+ (`bt601` instead of `bt470bg`).
 */
export function resolveInColorMatrix(colorSpace?: string): 'bt601' | 'bt2020' | 'bt709' {
  if (colorSpace === 'bt470bg' || colorSpace === 'smpte170m') return 'bt601';
  if (colorSpace === 'bt2020' || colorSpace === 'bt2020nc') return 'bt2020';
  return 'bt709';
}

export function buildFFmpegArgs(options: {
  input: string;
  outputPattern: string;
  width: number;
  height: number;
  format?: 'webp' | 'avif' | 'jpeg';
  quality?: number;
  fps?: number;
  fit?: 'cover' | 'contain';
  colorSpace?: string;
  colorRange?: string;
}): string[] {
  const targetFps = options.fps ?? 30;
  const fitMode = options.fit ?? 'cover';
  const format = options.format ?? 'webp';
  const quality = resolveEncoderQuality(format, options.quality);

  const inMatrix = resolveInColorMatrix(options.colorSpace);
  const inRange = options.colorRange ?? 'tv';
  const colorOutOpts = `:in_color_matrix=${inMatrix}:in_range=${inRange}:out_range=pc`;
  const pixFmtFilter = ',format=rgb24';

  const scaleFilter = fitMode === 'cover'
    ? `scale=${options.width}:${options.height}:flags=lanczos+accurate_rnd+full_chroma_int${colorOutOpts}:force_original_aspect_ratio=increase,crop=${options.width}:${options.height}${pixFmtFilter}`
    : `scale=${options.width}:${options.height}:flags=lanczos+accurate_rnd+full_chroma_int${colorOutOpts}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=black${pixFmtFilter}`;

  const vf = `fps=fps=${targetFps}:round=near,${scaleFilter}`;
  const args: string[] = ['-y', '-hide_banner', '-nostdin', '-i', options.input, '-an', '-vf', vf];

  if (format === 'webp') {
    args.push('-c:v', 'libwebp', '-q:v', String(quality));
  } else if (format === 'avif') {
    args.push('-c:v', 'png');
  } else if (format === 'jpeg') {
    args.push('-c:v', 'mjpeg', '-q:v', jpegQualityToQscale(quality));
  }
  args.push('-f', 'image2', options.outputPattern);
  return args;
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

export async function compile(options: CompileOptions): Promise<AnimationManifest> {
  const inputResolved = path.resolve(options.input);
  const outputResolved = path.resolve(options.outputDir);

  // 1. Media Probe & Validation
  options.onProgress?.({ stage: 'probing', percent: 5, message: `Probing "${options.input}"` });
  const probeInfo = await probeMedia(inputResolved);

  // 2. Cache verification
  const buildHash = computeBuildHash(inputResolved, {
    variants: options.variants,
    format: options.format,
    quality: options.quality,
    fps: options.fps,
    step: options.step,
    start: options.start,
    end: options.end,
    packing: options.packing,
    chunkSize: options.chunkSize,
    fit: options.fit,
    checksum: options.checksum,
    anchors: options.anchors,
    motionLut: options.motionLut,
  });

  if (!options.force) {
    const cached = checkBuildCache(outputResolved, buildHash);
    if (cached) {
      options.onProgress?.({ stage: 'complete', percent: 100, message: 'Build cache hit (reused existing outputs)' });
      return cached;
    }
  }

  if (options.signal?.aborted) {
    throw new Error('Compilation aborted');
  }

  // 3. Setup Atomic Workspace
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tmpDir = path.join(outputResolved, `.tmp-${randomSuffix}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const activeProcesses = new Set<ChildProcess>();

  const cleanup = () => {
    for (const proc of activeProcesses) {
      try {
        proc.kill('SIGKILL');
      } catch { /* process already exited during cleanup */ }
    }
    activeProcesses.clear();
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch { /* best-effort temp directory cleanup */ }
  };

  const onAbort = () => {
    cleanup();
  };

  if (options.signal) {
    options.signal.addEventListener('abort', onAbort, { once: true });
  }

  const sigintHandler = () => {
    cleanup();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigintHandler);

  try {
    // 4. Determine Variants Configuration
    const defaultFormat = options.format ?? 'webp';
    const targetFps = options.fps ?? Math.round(probeInfo.fps) ?? 30;
    const globalFit = options.fit ?? 'cover';
    const isPortraitSource = probeInfo.effectiveHeight > probeInfo.effectiveWidth;

    const variantsConfig: VariantDefinition[] = options.variants && options.variants.length > 0
      ? options.variants
      : isPortraitSource
        ? [
            {
              id: 'desktop',
              width: probeInfo.effectiveWidth,
              height: probeInfo.effectiveHeight,
              minWidth: 768,
              fit: globalFit,
            },
            {
              id: 'mobile',
              width: Math.min(360, probeInfo.effectiveWidth),
              height: Math.round((Math.min(360, probeInfo.effectiveWidth) * probeInfo.effectiveHeight) / probeInfo.effectiveWidth),
              minWidth: 0,
              maxWidth: 767,
              fit: globalFit,
            },
          ]
        : [
            { id: 'desktop', width: 1920, height: 1080, minWidth: 768, fit: globalFit },
            { id: 'mobile', width: 640, height: 360, minWidth: 0, maxWidth: 767, fit: globalFit },
          ];

    // Ensure all target dimensions are even numbers
    for (const v of variantsConfig) {
      v.width = Math.max(2, Math.floor(v.width / 2) * 2);
      v.height = Math.max(2, Math.floor(v.height / 2) * 2);
    }

    // 5. Check if Single-Pass Multi-Output extraction is feasible
    const hasMultiFormats = Boolean(
      (options.formats && options.formats.length > 1) ||
      variantsConfig.some((v) => v.formats && v.formats.length > 1)
    );
    const allSameFormat = !hasMultiFormats && variantsConfig.every((v) => (v.format ?? defaultFormat) === defaultFormat);
    const allSameFps = variantsConfig.every((v) => (v.fps ?? targetFps) === targetFps);
    const canUseSinglePass = variantsConfig.length > 1 && allSameFormat && allSameFps;

    const binary = findFFmpegBinary();
    const requiredFormats = new Set<'webp' | 'avif' | 'jpeg'>([defaultFormat]);
    for (const f of options.formats ?? []) requiredFormats.add(f);
    for (const v of variantsConfig) {
      if (v.format) requiredFormats.add(v.format);
      for (const f of v.formats ?? []) requiredFormats.add(f);
    }
    const encoders = checkFFmpegEncoders(undefined, binary);
    const formatToEncoder: Record<'webp' | 'avif' | 'jpeg', keyof typeof encoders> = {
      webp: 'libwebp',
      avif: 'libaom-av1',
      jpeg: 'mjpeg',
    };
    for (const fmt of requiredFormats) {
      const enc = formatToEncoder[fmt];
      if (!encoders[enc]) {
        const fallback = fmt === 'jpeg' ? 'webp' : 'jpeg';
        throw new Error(
          `Missing FFmpeg encoder "${enc}" required for format "${fmt}". Switch formats with --format ${fallback} (or install an FFmpeg build with ${enc}).`
        );
      }
    }
    const manifestId = options.id ?? path.basename(inputResolved, path.extname(inputResolved));

    // Compute frame estimates from probe and range options
    const startSec = parseTimeSeconds(options.start) ?? 0;
    const endSec = parseTimeSeconds(options.end) ?? (probeInfo.duration > 0 ? probeInfo.duration : undefined);
    const clipDuration = endSec !== undefined ? Math.max(0, endSec - startSec) : (probeInfo.duration > 0 ? probeInfo.duration - startSec : 0);
    const step = options.step ?? 1;
    const estimatedTotalFrames = clipDuration > 0
      ? Math.max(1, Math.floor((clipDuration * targetFps) / step))
      : 0;

    // Per-variant extraction output directories inside tmpDir
    for (const v of variantsConfig) {
      fs.mkdirSync(path.join(tmpDir, v.id), { recursive: true });
    }

    options.onProgress?.({
      stage: 'extracting',
      percent: 15,
      total: estimatedTotalFrames > 0 ? estimatedTotalFrames : undefined,
      message: 'Extracting video frames',
    });

    if (canUseSinglePass) {
      // Build single-pass filter graph with split
      const filterParts: string[] = [];
      const splitOutputs = variantsConfig.map((_, i) => `[v${i}]`).join('');
      filterParts.push(`[0:v]fps=fps=${targetFps}:round=near,split=${variantsConfig.length}${splitOutputs}`);

      for (let i = 0; i < variantsConfig.length; i++) {
        const v = variantsConfig[i];
        const fitMode = v.fit ?? globalFit;
        let scaleFilter = '';
        const inMatrix = resolveInColorMatrix(probeInfo.colorSpace);
        const inRange = probeInfo.colorRange ?? 'tv';
        const colorOutOpts = `:in_color_matrix=${inMatrix}:in_range=${inRange}:out_range=pc`;
        const pixFmtFilter = ',format=rgb24';

        if (fitMode === 'cover') {
          scaleFilter = `scale=${v.width}:${v.height}:flags=lanczos+accurate_rnd+full_chroma_int${colorOutOpts}:force_original_aspect_ratio=increase,crop=${v.width}:${v.height}${pixFmtFilter}`;
        } else {
          scaleFilter = `scale=${v.width}:${v.height}:flags=lanczos+accurate_rnd+full_chroma_int${colorOutOpts}:force_original_aspect_ratio=decrease,pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2:color=black${pixFmtFilter}`;
        }
        filterParts.push(`[v${i}]${scaleFilter}[out${i}]`);
      }

      const args: string[] = ['-y', '-hide_banner', '-nostdin'];
      if (options.start !== undefined && options.start !== null) {
        args.push('-ss', String(options.start));
      }
      if (endSec !== undefined && endSec > startSec) {
        args.push('-t', String(endSec - startSec));
      }
      args.push('-i', inputResolved);
      args.push('-an');
      args.push('-filter_complex', filterParts.join(';'));

      const isAvif = defaultFormat === 'avif';
      const ext = isAvif ? 'png' : (defaultFormat === 'jpeg' ? 'jpg' : defaultFormat);

      for (let i = 0; i < variantsConfig.length; i++) {
        const v = variantsConfig[i];
        const outPattern = path.join(tmpDir, v.id, `frame_%04d.${ext}`);
        args.push('-map', `[out${i}]`);
        if (defaultFormat === 'webp') {
          args.push('-c:v', 'libwebp', '-q:v', String(v.quality ?? options.quality ?? 80));
        } else if (defaultFormat === 'avif') {
          args.push('-c:v', 'png');
        } else if (defaultFormat === 'jpeg') {
          args.push('-c:v', 'mjpeg', '-q:v', jpegQualityToQscale(v.quality ?? options.quality ?? 85));
        }
        args.push('-f', 'image2', outPattern);
      }

      console.log('SPAWNING FFMPEG ARGS:', JSON.stringify(args));
      const proc = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      activeProcesses.add(proc);

      let errOutput = '';
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
            console.error(`\n❌ FFmpeg stalled: 30s watchdog triggered without progress.\nStderr tail:\n${tail}`);
            reject(new Error(`FFmpeg stalled: 30s watchdog triggered without progress. Stderr tail:\n${tail}`));
          }, 30000);
        };

        resetWatchdog();

        proc.stderr.on('data', (d: Buffer) => {
          const text = d.toString();
          errOutput += text;

          const lines = text.split(/\r?\n/);
          for (const line of lines) {
            if (line.trim()) {
              recentStderrLines.push(line.trim());
              if (recentStderrLines.length > 50) recentStderrLines.shift();
            }
          }

          const matches = text.match(/frame=\s*(\d+)/g);
          if (matches && matches.length > 0) {
            resetWatchdog();
            const lastMatch = matches[matches.length - 1];
            const numMatch = lastMatch.match(/\d+/);
            if (numMatch) {
              const currentFrame = parseInt(numMatch[0], 10);
              const pct = estimatedTotalFrames > 0
                ? Math.min(95, Math.round((currentFrame / estimatedTotalFrames) * 80) + 15)
                : 15;
              options.onProgress?.({
                stage: 'extracting',
                frame: currentFrame,
                total: estimatedTotalFrames > 0 ? estimatedTotalFrames : undefined,
                percent: pct,
                message: estimatedTotalFrames > 0
                  ? `Extracting frame ${currentFrame}/${estimatedTotalFrames}`
                  : `Extracting frame ${currentFrame}`,
              });
            }
          }
        });

        if (options.signal?.aborted) {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          proc.kill('SIGKILL');
          return reject(new Error('Compilation aborted'));
        }
        const abortHandler = () => {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          proc.kill('SIGKILL');
          reject(new Error('Compilation aborted'));
        };
        options.signal?.addEventListener('abort', abortHandler, { once: true });
        proc.on('close', (code) => {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          options.signal?.removeEventListener('abort', abortHandler);
          resolve(code ?? 0);
        });
        proc.on('error', (err) => {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          options.signal?.removeEventListener('abort', abortHandler);
          reject(err);
        });
      });
      activeProcesses.delete(proc);

      if (exitCode !== 0) {
        throw new Error(`FFmpeg single-pass extraction failed with exit code ${exitCode}:\n${errOutput}`);
      }

      if (isAvif) {
        options.onProgress?.({ stage: 'extracting', percent: 45, message: 'Encoding AVIF frames via Sharp' });
        for (const v of variantsConfig) {
          await convertPngsToAvif(path.join(tmpDir, v.id), v.quality ?? options.quality ?? 65, options.signal);
        }
      }
    } else {
      // Sequential extraction per variant (and per format when multi-format is configured)
      for (let idx = 0; idx < variantsConfig.length; idx++) {
        const v = variantsConfig[idx];
        const vFormats: Array<'webp' | 'avif' | 'jpeg'> =
          v.formats && v.formats.length > 0
            ? v.formats
            : options.formats && options.formats.length > 0
              ? options.formats
              : [v.format ?? defaultFormat];
        const vFps = v.fps ?? targetFps;
        const fitMode = v.fit ?? globalFit;

        for (const vFormat of vFormats) {
          const isAvif = vFormat === 'avif';
          const ext = isAvif ? 'png' : (vFormat === 'jpeg' ? 'jpg' : vFormat);

          let scaleFilter = '';
          const inMatrix = resolveInColorMatrix(probeInfo.colorSpace);
          const inRange = probeInfo.colorRange ?? 'tv';
          const colorOutOpts = `:in_color_matrix=${inMatrix}:in_range=${inRange}:out_range=pc`;
          const pixFmtFilter = ',format=rgb24';

          if (fitMode === 'cover') {
            scaleFilter = `scale=${v.width}:${v.height}:flags=lanczos+accurate_rnd+full_chroma_int${colorOutOpts}:force_original_aspect_ratio=increase,crop=${v.width}:${v.height}${pixFmtFilter}`;
          } else {
            scaleFilter = `scale=${v.width}:${v.height}:flags=lanczos+accurate_rnd+full_chroma_int${colorOutOpts}:force_original_aspect_ratio=decrease,pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2:color=black${pixFmtFilter}`;
          }

          const args: string[] = ['-y', '-hide_banner', '-nostdin'];
          if (options.start !== undefined && options.start !== null) {
            args.push('-ss', String(options.start));
          }
          if (endSec !== undefined && endSec > startSec) {
            args.push('-t', String(endSec - startSec));
          }
          args.push('-i', inputResolved);
          args.push('-an');
          args.push('-vf', `fps=fps=${vFps}:round=near,${scaleFilter}`);

          if (vFormat === 'webp') {
            args.push('-c:v', 'libwebp', '-q:v', String(v.quality ?? options.quality ?? 80));
          } else if (vFormat === 'avif') {
            args.push('-c:v', 'png');
          } else if (vFormat === 'jpeg') {
            args.push('-c:v', 'mjpeg', '-q:v', jpegQualityToQscale(v.quality ?? options.quality ?? 85));
          }

          const outPattern = path.join(tmpDir, v.id, `frame_%04d.${ext}`);
          args.push('-f', 'image2', outPattern);

          console.log('SPAWNING FFMPEG ARGS:', JSON.stringify(args));
          const proc = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
          activeProcesses.add(proc);

          let errOutput = '';
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
                console.error(`\n❌ FFmpeg stalled: 30s watchdog triggered without progress.\nStderr tail:\n${tail}`);
                reject(new Error(`FFmpeg stalled: 30s watchdog triggered without progress. Stderr tail:\n${tail}`));
              }, 30000);
            };

            resetWatchdog();

            proc.stderr.on('data', (d: Buffer) => {
              const text = d.toString();
              errOutput += text;

              const lines = text.split(/\r?\n/);
              for (const line of lines) {
                if (line.trim()) {
                  recentStderrLines.push(line.trim());
                  if (recentStderrLines.length > 50) recentStderrLines.shift();
                }
              }

              const matches = text.match(/frame=\s*(\d+)/g);
              if (matches && matches.length > 0) {
                resetWatchdog();
                const lastMatch = matches[matches.length - 1];
                const numMatch = lastMatch.match(/\d+/);
                if (numMatch) {
                  const currentFrame = parseInt(numMatch[0], 10);
                  const pct = estimatedTotalFrames > 0
                    ? Math.min(95, Math.round((currentFrame / estimatedTotalFrames) * 80) + 15)
                    : 15;
                  options.onProgress?.({
                    stage: 'extracting',
                    frame: currentFrame,
                    total: estimatedTotalFrames > 0 ? estimatedTotalFrames : undefined,
                    percent: pct,
                    variantId: v.id,
                    message: estimatedTotalFrames > 0
                      ? `Extracting frame ${currentFrame}/${estimatedTotalFrames} for ${v.id}`
                      : `Extracting frame ${currentFrame} for ${v.id}`,
                  });
                }
              }
            });

            if (options.signal?.aborted) {
              if (watchdogTimer) clearTimeout(watchdogTimer);
              proc.kill('SIGKILL');
              return reject(new Error('Compilation aborted'));
            }
            const abortHandler = () => {
              if (watchdogTimer) clearTimeout(watchdogTimer);
              proc.kill('SIGKILL');
              reject(new Error('Compilation aborted'));
            };
            options.signal?.addEventListener('abort', abortHandler, { once: true });
            proc.on('close', (code) => {
              if (watchdogTimer) clearTimeout(watchdogTimer);
              options.signal?.removeEventListener('abort', abortHandler);
              resolve(code ?? 0);
            });
            proc.on('error', (err) => {
              if (watchdogTimer) clearTimeout(watchdogTimer);
              options.signal?.removeEventListener('abort', abortHandler);
              reject(err);
            });
          });
          activeProcesses.delete(proc);

          if (exitCode !== 0) {
            throw new Error(`FFmpeg extraction failed for variant "${v.id}" (${vFormat}) with code ${exitCode}:\n${errOutput}`);
          }

          if (isAvif) {
            options.onProgress?.({ stage: 'extracting', percent: 45, variantId: v.id, message: `Encoding AVIF frames via Sharp for ${v.id}` });
            await convertPngsToAvif(path.join(tmpDir, v.id), v.quality ?? options.quality ?? 65, options.signal);
          }
        }
      }
    }

    // 6. Gather Frame Files & Build Manifest Variants
    const packing = options.packing ?? 'individual';
    const chunkSize = options.chunkSize ?? 24;
    const computedVariants: ResolutionVariant[] = [];
    let recordedTotalFrames = 0;

    for (let idx = 0; idx < variantsConfig.length; idx++) {
      const v = variantsConfig[idx];
      const vFormats: Array<'webp' | 'avif' | 'jpeg'> =
        v.formats && v.formats.length > 0
          ? v.formats
          : options.formats && options.formats.length > 0
            ? options.formats
            : [v.format ?? defaultFormat];
      const primaryFormat = vFormats[0];
      const ext = primaryFormat === 'jpeg' ? 'jpg' : primaryFormat;
      const mimeType: ImageMimeType = `image/${primaryFormat === 'jpeg' ? 'jpeg' : primaryFormat}` as ImageMimeType;
      const vDir = path.join(tmpDir, v.id);

      const files = fs.readdirSync(vDir)
        .filter((f) => f.startsWith('frame_') && f.endsWith(`.${ext}`))
        .sort();

      const framesCount = files.length;
      if (framesCount === 0) {
        throw new Error(`No frames extracted for variant "${v.id}"`);
      }
      if (recordedTotalFrames === 0) {
        recordedTotalFrames = framesCount;
      }

      const frameSizes: number[] = [];
      let totalBytes = 0;

      for (const f of files) {
        const s = fs.statSync(path.join(vDir, f)).size;
        frameSizes.push(s);
        totalBytes += s;
      }

      const decodedRgbaBytesPerFrame = v.width * v.height * 4;
      const variantStats: VariantStats = {
        totalBytes,
        minFrameBytes: Math.min(...frameSizes),
        medianFrameBytes: calculateMedian(frameSizes),
        maxFrameBytes: Math.max(...frameSizes),
        decodedRgbaBytesPerFrame,
        estimatedDecodedMemoryBytes: decodedRgbaBytesPerFrame * framesCount,
      };

      if (packing === 'individual') {
        const variantObj: ResolutionVariant = {
          id: v.id,
          minWidth: v.minWidth,
          maxWidth: v.maxWidth,
          width: v.width,
          height: v.height,
          format: mimeType,
          packing: 'individual',
          frameTemplate: `${v.id}/frame_%04d.${ext}?v=${buildHash.slice(0, 10)}`,
          frameStartIndex: 1,
          framesCount,
          stats: variantStats,
        };

        if (vFormats.length > 1) {
          variantObj.formats = vFormats.map((fmt) => `image/${fmt === 'jpeg' ? 'jpeg' : fmt}` as ImageMimeType);
          const sources: VariantFormatSource[] = [];
          for (const fmt of vFormats) {
            const fmtExt = fmt === 'jpeg' ? 'jpg' : fmt;
            const fmtMime = `image/${fmt === 'jpeg' ? 'jpeg' : fmt}` as ImageMimeType;
            const fmtFiles = fs.readdirSync(vDir)
              .filter((f) => f.startsWith('frame_') && f.endsWith(`.${fmtExt}`))
              .sort();
            const fmtSizes = fmtFiles.map((f) => fs.statSync(path.join(vDir, f)).size);
            const fmtTotal = fmtSizes.reduce((a, b) => a + b, 0);
            const fmtStats: VariantStats = {
              totalBytes: fmtTotal,
              minFrameBytes: Math.min(...fmtSizes),
              medianFrameBytes: calculateMedian(fmtSizes),
              maxFrameBytes: Math.max(...fmtSizes),
              decodedRgbaBytesPerFrame,
              estimatedDecodedMemoryBytes: decodedRgbaBytesPerFrame * fmtFiles.length,
            };
            sources.push({
              format: fmtMime,
              frameTemplate: `${v.id}/frame_%04d.${fmtExt}?v=${buildHash.slice(0, 10)}`,
              frameStartIndex: 1,
              framesCount: fmtFiles.length,
              stats: fmtStats,
              ...(options.checksum
                ? {
                    frames: fmtFiles.map((f, i) => {
                      const buf = fs.readFileSync(path.join(vDir, f));
                      return {
                        id: i,
                        src: `${v.id}/${f}`,
                        byteLength: buf.length,
                        checksum: computeSha256(buf),
                        checksumType: 'sha256' as const,
                      };
                    }),
                  }
                : {}),
            });
          }
          variantObj.sources = sources;
        }

        if (options.checksum) {
          options.onProgress?.({ stage: 'checksums', percent: 60, variantId: v.id, message: `Computing SHA-256 for ${v.id}` });
          variantObj.frames = files.map((f, i) => {
            const buf = fs.readFileSync(path.join(vDir, f));
            return {
              id: i,
              src: `${v.id}/${f}`,
              byteLength: buf.length,
              checksum: computeSha256(buf),
              checksumType: 'sha256',
            };
          });
        }

        computedVariants.push(variantObj);
      } else if (packing === 'chunked') {
        options.onProgress?.({ stage: 'packing', percent: 65, variantId: v.id, message: `Packaging CEPK chunks for ${v.id}` });
        const chunks = [];
        const numChunks = Math.ceil(framesCount / chunkSize);

        for (let c = 0; c < numChunks; c++) {
          const start = c * chunkSize;
          const end = Math.min(start + chunkSize, framesCount);
          const chunkFrames = [];

          for (let fIdx = start; fIdx < end; fIdx++) {
            const buf = fs.readFileSync(path.join(vDir, files[fIdx]));
            chunkFrames.push({
              frameIndex: fIdx,
              data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
            });
          }

          const packedBuffer = packCEPK(chunkFrames);
          const chunkFileName = `c_${String(c).padStart(3, '0')}.bin`;
          const chunkRelPath = `${v.id}/${chunkFileName}`;
          const chunkFullPath = path.join(vDir, chunkFileName);
          fs.writeFileSync(chunkFullPath, Buffer.from(packedBuffer));

          const chunkBuf = Buffer.from(packedBuffer);
          chunks.push({
            index: c,
            startFrame: start,
            endFrame: end - 1,
            src: chunkRelPath,
            byteLength: chunkBuf.length,
            framesCount: end - start,
            ...(options.checksum ? { checksum: computeSha256(chunkBuf), checksumType: 'sha256' as const } : {}),
          });
        }

        // Clean up individual raw frame files
        for (const f of files) {
          fs.unlinkSync(path.join(vDir, f));
        }

        computedVariants.push({
          id: v.id,
          minWidth: v.minWidth,
          maxWidth: v.maxWidth,
          width: v.width,
          height: v.height,
          format: mimeType,
          packing: 'chunked',
          chunkSize,
          chunks,
          stats: variantStats,
        });
      } else if (packing === 'range') {
        options.onProgress?.({ stage: 'packing', percent: 65, variantId: v.id, message: `Building monolithic range pack for ${v.id}` });
        const packFileName = `${v.id}_frames.bin`;
        const packRelPath = `${v.id}/${packFileName}`;
        const packFullPath = path.join(vDir, packFileName);
        const outStream = fs.createWriteStream(packFullPath);

        const frames = [];
        let currentOffset = 0;

        for (let fIdx = 0; fIdx < framesCount; fIdx++) {
          const buf = fs.readFileSync(path.join(vDir, files[fIdx]));
          outStream.write(buf);
          frames.push({
            id: fIdx,
            src: packRelPath,
            byteOffset: currentOffset,
            byteLength: buf.length,
            ...(options.checksum ? { checksum: computeSha256(buf), checksumType: 'sha256' as const } : {}),
          });
          currentOffset += buf.length;
        }

        await new Promise((resolve) => outStream.end(resolve));

        // Clean up individual raw frame files
        for (const f of files) {
          fs.unlinkSync(path.join(vDir, f));
        }

        computedVariants.push({
          id: v.id,
          minWidth: v.minWidth,
          maxWidth: v.maxWidth,
          width: v.width,
          height: v.height,
          format: mimeType,
          packing: 'range',
          singlePackUrl: packRelPath,
          frames,
          stats: variantStats,
        });
      }
    }

    // 7. Optional Anchor Frame Set
    if (options.anchors && options.anchors > 0) {
      options.onProgress?.({ stage: 'anchors', percent: 80, message: 'Generating low-res anchor frames' });
      const primaryVariant = computedVariants[0];
      const anchorSet = await generateAnchorSet({
        input: inputResolved,
        outputDir: tmpDir,
        sourceWidth: primaryVariant.width,
        sourceHeight: primaryVariant.height,
        step: options.anchors,
        fps: targetFps,
        format: defaultFormat,
        quality: options.quality,
        start: options.start,
        end: options.end,
        signal: options.signal,
      });

      // Attach anchor set to primary desktop variant
      computedVariants[0].anchors = anchorSet;
    }

    // 8. Motion LUT computation
    let motionLut: number[] | undefined;
    if (options.motionLut === 'auto') {
      options.onProgress?.({ stage: 'motion-lut', percent: 88, message: 'Analyzing frame-to-frame motion velocity' });
      motionLut = await computeMotionLut({
        input: inputResolved,
        fps: targetFps,
        start: options.start ? String(options.start) : undefined,
        end: options.end ? String(options.end) : undefined,
        signal: options.signal,
      });
    } else if (options.motionLut === 'linear') {
      motionLut = [0, 1];
    } else if (options.motionLut && fs.existsSync(options.motionLut)) {
      motionLut = JSON.parse(fs.readFileSync(options.motionLut, 'utf8'));
    } else {
      motionLut = [0, 1]; // standard linear identity
    }

    // 9. Assemble Manifest
    const calculatedDuration = recordedTotalFrames / targetFps;
    const manifest: AnimationManifest = {
      $schema: 'https://raw.githubusercontent.com/FairyTail-100/Zoetrope/main/schema/v1.json',
      version: '1.0.0',
      id: manifestId,
      metadata: {
        totalFrames: recordedTotalFrames,
        fps: targetFps,
        duration: Math.round(calculatedDuration * 100) / 100,
        aspectRatio: `${computedVariants[0].width}:${computedVariants[0].height}`,
        contentHash: buildHash,
      },
      variants: computedVariants,
      motion: {
        defaultEasing: 'linear',
        lut: motionLut,
      },
    };

    validateManifest(manifest);

    // Write manifest into tmpDir
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    if (options.signal?.aborted) {
      throw new Error('Compilation aborted');
    }

    // 10. Atomic Rename / Commit to Output Directory
    fs.mkdirSync(outputResolved, { recursive: true });

    // Move all items from tmpDir to outputResolved
    const tmpItems = fs.readdirSync(tmpDir);
    for (const item of tmpItems) {
      const srcPath = path.join(tmpDir, item);
      const destPath = path.join(outputResolved, item);
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      fs.renameSync(srcPath, destPath);
    }

    // Clean up empty tmpDir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort temp directory cleanup after atomic rename */ }

    // Save build cache metadata
    saveBuildCache(outputResolved, inputResolved, buildHash, options);

    options.onProgress?.({ stage: 'complete', percent: 100, message: 'Compilation complete' });
    return manifest;
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('SIGTERM', sigintHandler);
  }
}
