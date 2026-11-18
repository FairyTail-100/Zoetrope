import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AnimationManifest } from '@zoetropejs/manifest';

export const COMPILER_VERSION = '1.0.0';

export interface BuildCacheRecord {
  compilerVersion: string;
  buildHash: string;
  inputPath: string;
  inputSize: number;
  inputMtimeMs: number;
  createdAt: string;
  optionsSummary: string;
}

/**
 * Computes a deterministic SHA-256 hash over the FULL input file content,
 * compiler options, and compiler version.
 */
export function computeBuildHash(inputPath: string, options: unknown): string {
  const hasher = crypto.createHash('sha256');
  hasher.update(COMPILER_VERSION);

  const stat = fs.statSync(inputPath);
  hasher.update(String(stat.size));

  const fd = fs.openSync(inputPath, 'r');
  try {
    const chunkSize = 64 * 1024;
    const buf = Buffer.allocUnsafe(chunkSize);
    let bytesRead = 0;
    let position = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, chunkSize, position)) > 0) {
      hasher.update(bytesRead === chunkSize ? buf : buf.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }

  // Options identity
  hasher.update(JSON.stringify(options));
  return hasher.digest('hex');
}

/**
 * Checks whether an existing build in outputDir matches the current build hash.
 */
export function checkBuildCache(
  outputDir: string,
  buildHash: string
): AnimationManifest | null {
  const cacheFile = path.join(outputDir, '.build-cache.json');
  const manifestFile = path.join(outputDir, 'manifest.json');

  if (!fs.existsSync(cacheFile) || !fs.existsSync(manifestFile)) {
    return null;
  }

  try {
    const record: BuildCacheRecord = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (record.buildHash !== buildHash || record.compilerVersion !== COMPILER_VERSION) {
      return null;
    }

    const manifest: AnimationManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    // Verify that variant directories exist
    for (const v of manifest.variants) {
      if (v.packing === 'individual' && v.frameTemplate) {
        const cleanTemplate = v.frameTemplate.split('?')[0];
        const sampleFrame = path.join(outputDir, cleanTemplate.replace(/%0?(\d+)d/, '0001'));
        if (!fs.existsSync(sampleFrame)) return null;
      }
    }

    return manifest;
  } catch {
    return null;
  }
}

/**
 * Saves build cache metadata upon successful compilation.
 */
export function saveBuildCache(
  outputDir: string,
  inputPath: string,
  buildHash: string,
  options: unknown
): void {
  const cacheFile = path.join(outputDir, '.build-cache.json');
  const stat = fs.statSync(inputPath);

  const record: BuildCacheRecord = {
    compilerVersion: COMPILER_VERSION,
    buildHash,
    inputPath: path.resolve(inputPath),
    inputSize: stat.size,
    inputMtimeMs: stat.mtimeMs,
    createdAt: new Date().toISOString(),
    optionsSummary: JSON.stringify(options),
  };

  fs.writeFileSync(cacheFile, JSON.stringify(record, null, 2), 'utf8');
}
