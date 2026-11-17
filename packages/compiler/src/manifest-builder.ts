import * as fs from 'node:fs';
import * as path from 'node:path';
import { AnimationManifest, ResolutionVariant, validateManifest } from '@zoetrope/manifest';

export interface ManifestBuilderOptions {
  id: string;
  totalFrames: number;
  fps: number;
  variants: ResolutionVariant[];
  outputDir: string;
  lut?: number[];
  aspectRatio?: string;
}

export function generateManifest(options: ManifestBuilderOptions): AnimationManifest {
  const duration = Math.round((options.totalFrames / options.fps) * 100) / 100;

  const manifest: AnimationManifest = {
    $schema: 'https://raw.githubusercontent.com/FairyTail-100/Zoetrope/main/schema/v1.json',
    version: '1.0.0',
    id: options.id,
    metadata: {
      totalFrames: options.totalFrames,
      fps: options.fps,
      duration,
      aspectRatio: options.aspectRatio ?? '16:9',
    },
    variants: options.variants,
    motion: {
      defaultEasing: 'linear',
      lut: options.lut ?? [0, 1],
    },
  };

  const validated = validateManifest(manifest);
  const outPath = path.join(options.outputDir, 'manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(validated, null, 2), 'utf-8');

  return validated;
}
