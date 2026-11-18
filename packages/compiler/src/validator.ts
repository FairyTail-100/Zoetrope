import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AnimationManifest,
  validateManifest,
  CEPK_HEADER_SIZE,
  CEPK_MAGIC,
} from '@zoetropejs/manifest';
import { readImageDimensions } from './image-header.js';

export type ValidationErrorCode =
  | 'SCHEMA_INVALID'
  | 'FILE_NOT_FOUND'
  | 'SIZE_MISMATCH'
  | 'CHECKSUM_MISMATCH'
  | 'GAP_IN_FRAMES'
  | 'CORRUPT_IMAGE'
  | 'DIMENSION_MISMATCH';

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  variantId?: string;
  frameId?: number;
  filePath?: string;
  expected?: string | number;
  actual?: string | number;
}

export interface ValidateOptions {
  deep?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  manifestPath: string;
  checkedVariants: number;
  checkedFrames: number;
  errors: ValidationError[];
  warnings: string[];
  deepValidated: boolean;
}

function computeSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Validates a Zoetrope manifest file on disk and verifies all referenced assets.
 */
export async function validateManifestFile(
  manifestPath: string,
  options?: ValidateOptions
): Promise<ValidationResult> {
  const resolvedManifestPath = path.resolve(manifestPath);
  const baseDir = path.dirname(resolvedManifestPath);

  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  let checkedFrames = 0;

  if (!fs.existsSync(resolvedManifestPath)) {
    return {
      valid: false,
      manifestPath: resolvedManifestPath,
      checkedVariants: 0,
      checkedFrames: 0,
      errors: [
        {
          code: 'FILE_NOT_FOUND',
          message: `Manifest file not found: "${resolvedManifestPath}"`,
          filePath: resolvedManifestPath,
        },
      ],
      warnings: [],
      deepValidated: false,
    };
  }

  let rawJson: unknown;
  try {
    const content = fs.readFileSync(resolvedManifestPath, 'utf8');
    rawJson = JSON.parse(content);
  } catch (err: any) {
    return {
      valid: false,
      manifestPath: resolvedManifestPath,
      checkedVariants: 0,
      checkedFrames: 0,
      errors: [
        {
          code: 'SCHEMA_INVALID',
          message: `Malformed JSON in manifest: ${err.message}`,
          filePath: resolvedManifestPath,
        },
      ],
      warnings: [],
      deepValidated: false,
    };
  }

  let manifest: AnimationManifest;
  try {
    manifest = validateManifest(rawJson);
  } catch (err: any) {
    return {
      valid: false,
      manifestPath: resolvedManifestPath,
      checkedVariants: 0,
      checkedFrames: 0,
      errors: [
        {
          code: 'SCHEMA_INVALID',
          message: `Manifest schema validation failed: ${err.message}`,
          filePath: resolvedManifestPath,
        },
      ],
      warnings: [],
      deepValidated: false,
    };
  }

  const checkedVariants = manifest.variants.length;

  for (const variant of manifest.variants) {
    const expectedWidth = variant.width;
    const expectedHeight = variant.height;

    if (variant.packing === 'individual') {
      if (variant.frames && variant.frames.length > 0) {
        // Explicit frames list
        let prevId = -1;

        for (let i = 0; i < variant.frames.length; i++) {
          const frame = variant.frames[i];
          checkedFrames++;

          // Check continuity
          if (frame.id !== prevId + 1) {
            errors.push({
              code: 'GAP_IN_FRAMES',
              message: `Discontinuity in frame sequence at index ${i}: expected id ${prevId + 1}, received ${frame.id}`,
              variantId: variant.id,
              frameId: frame.id,
              expected: prevId + 1,
              actual: frame.id,
            });
          }
          prevId = frame.id;

          if (!frame.src) {
            errors.push({
              code: 'SCHEMA_INVALID',
              message: `Frame ${frame.id} in variant "${variant.id}" is missing 'src'`,
              variantId: variant.id,
              frameId: frame.id,
            });
            continue;
          }

          const fullPath = path.join(baseDir, frame.src);
          if (!fs.existsSync(fullPath)) {
            errors.push({
              code: 'FILE_NOT_FOUND',
              message: `Frame file missing on disk: "${frame.src}"`,
              variantId: variant.id,
              frameId: frame.id,
              filePath: fullPath,
            });
            continue;
          }

          const stat = fs.statSync(fullPath);

          // Verify byte size
          if (frame.byteLength !== undefined && stat.size !== frame.byteLength) {
            errors.push({
              code: 'SIZE_MISMATCH',
              message: `Byte length mismatch for "${frame.src}": manifest says ${frame.byteLength}, disk has ${stat.size}`,
              variantId: variant.id,
              frameId: frame.id,
              filePath: fullPath,
              expected: frame.byteLength,
              actual: stat.size,
            });
          }

          // Verify sha256 checksum
          if (frame.checksum && frame.checksumType === 'sha256') {
            const actualHash = computeSha256(fullPath);
            if (actualHash !== frame.checksum) {
              errors.push({
                code: 'CHECKSUM_MISMATCH',
                message: `SHA-256 checksum mismatch for "${frame.src}"`,
                variantId: variant.id,
                frameId: frame.id,
                filePath: fullPath,
                expected: frame.checksum,
                actual: actualHash,
              });
            }
          }

          if (options?.deep) {
            try {
              const dims = readImageDimensions(fullPath);
              if (dims.width !== expectedWidth || dims.height !== expectedHeight) {
                errors.push({
                  code: 'DIMENSION_MISMATCH',
                  message: `Frame dimensions (${dims.width}x${dims.height}) do not match variant declaration (${expectedWidth}x${expectedHeight}) in "${frame.src}"`,
                  variantId: variant.id,
                  frameId: frame.id,
                  filePath: fullPath,
                  expected: `${expectedWidth}x${expectedHeight}`,
                  actual: `${dims.width}x${dims.height}`,
                });
              }
            } catch (err: any) {
              errors.push({
                code: 'CORRUPT_IMAGE',
                message: `Corrupt image header in "${frame.src}": ${err.message}`,
                variantId: variant.id,
                frameId: frame.id,
                filePath: fullPath,
              });
            }
          }
        }
      } else if (variant.frameTemplate) {
        // Compact template mode
        const total = variant.framesCount ?? manifest.metadata.totalFrames;
        const startIndex = variant.frameStartIndex ?? 1;

        for (let i = startIndex; i < startIndex + total; i++) {
          checkedFrames++;
          const relPath = variant.frameTemplate.replace('%04d', String(i).padStart(4, '0'));
          const fullPath = path.join(baseDir, relPath);

          if (!fs.existsSync(fullPath)) {
            errors.push({
              code: 'FILE_NOT_FOUND',
              message: `Frame file missing on disk: "${relPath}"`,
              variantId: variant.id,
              frameId: i - startIndex,
              filePath: fullPath,
            });
            continue;
          }

          if (options?.deep) {
            try {
              const dims = readImageDimensions(fullPath);
              if (dims.width !== expectedWidth || dims.height !== expectedHeight) {
                errors.push({
                  code: 'DIMENSION_MISMATCH',
                  message: `Frame dimensions (${dims.width}x${dims.height}) do not match variant declaration (${expectedWidth}x${expectedHeight}) in "${relPath}"`,
                  variantId: variant.id,
                  frameId: i - startIndex,
                  filePath: fullPath,
                  expected: `${expectedWidth}x${expectedHeight}`,
                  actual: `${dims.width}x${dims.height}`,
                });
              }
            } catch (err: any) {
              errors.push({
                code: 'CORRUPT_IMAGE',
                message: `Corrupt image header in "${relPath}": ${err.message}`,
                variantId: variant.id,
                frameId: i - startIndex,
                filePath: fullPath,
              });
            }
          }
        }
      }
    } else if (variant.packing === 'chunked') {
      if (variant.chunks) {
        for (const chunk of variant.chunks) {
          const chunkPath = path.join(baseDir, chunk.src);
          if (!fs.existsSync(chunkPath)) {
            errors.push({
              code: 'FILE_NOT_FOUND',
              message: `Chunk file missing on disk: "${chunk.src}"`,
              variantId: variant.id,
              filePath: chunkPath,
            });
            continue;
          }

          const stat = fs.statSync(chunkPath);
          if (chunk.byteLength !== undefined && stat.size !== chunk.byteLength) {
            errors.push({
              code: 'SIZE_MISMATCH',
              message: `Chunk byte length mismatch for "${chunk.src}": manifest says ${chunk.byteLength}, disk has ${stat.size}`,
              variantId: variant.id,
              filePath: chunkPath,
              expected: chunk.byteLength,
              actual: stat.size,
            });
          }

          if (chunk.checksum && chunk.checksumType === 'sha256') {
            const actualHash = computeSha256(chunkPath);
            if (actualHash !== chunk.checksum) {
              errors.push({
                code: 'CHECKSUM_MISMATCH',
                message: `SHA-256 checksum mismatch for chunk "${chunk.src}"`,
                variantId: variant.id,
                filePath: chunkPath,
                expected: chunk.checksum,
                actual: actualHash,
              });
            }
          }

          // Check CEPK header layout
          if (stat.size >= CEPK_HEADER_SIZE) {
            const fd = fs.openSync(chunkPath, 'r');
            const hBuf = Buffer.alloc(CEPK_HEADER_SIZE);
            fs.readSync(fd, hBuf, 0, CEPK_HEADER_SIZE, 0);
            fs.closeSync(fd);

            const magic = hBuf.readUInt32LE(0);
            if (magic !== CEPK_MAGIC) {
              errors.push({
                code: 'CORRUPT_IMAGE',
                message: `Chunk "${chunk.src}" has invalid CEPK magic: 0x${magic.toString(16).toUpperCase()}`,
                variantId: variant.id,
                filePath: chunkPath,
              });
            }
          }
          checkedFrames += chunk.framesCount;
        }
      }
    } else if (variant.packing === 'range') {
      const packUrl = variant.singlePackUrl || (variant.frames && variant.frames[0]?.src);
      if (packUrl) {
        const packPath = path.join(baseDir, packUrl);
        if (!fs.existsSync(packPath)) {
          errors.push({
            code: 'FILE_NOT_FOUND',
            message: `Range single pack file missing on disk: "${packUrl}"`,
            variantId: variant.id,
            filePath: packPath,
          });
        }
      }
      checkedFrames += variant.frames?.length ?? 0;
    }

    // Check anchors if present
    if (variant.anchors?.frames) {
      for (const anchor of variant.anchors.frames) {
        const anchorPath = path.join(baseDir, anchor.src);
        if (!fs.existsSync(anchorPath)) {
          errors.push({
            code: 'FILE_NOT_FOUND',
            message: `Anchor frame file missing on disk: "${anchor.src}"`,
            variantId: variant.id,
            frameId: anchor.frameId,
            filePath: anchorPath,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    manifestPath: resolvedManifestPath,
    checkedVariants,
    checkedFrames,
    errors,
    warnings,
    deepValidated: !!options?.deep,
  };
}
