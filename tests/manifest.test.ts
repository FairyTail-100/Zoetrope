import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateManifest, selectVariant, AnimationManifest } from '../packages/manifest/src/index.js';
import { compile } from '../packages/compiler/src/compiler.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

describe('Manifest Validator & Variant Selection', () => {
  const validManifest: AnimationManifest = {
    version: '1.0.0',
    id: 'test-animation',
    metadata: {
      totalFrames: 120,
      fps: 30,
      duration: 4.0,
      aspectRatio: '16:9',
    },
    variants: [
      {
        id: 'desktop',
        minWidth: 1024,
        width: 1920,
        height: 1080,
        format: 'image/webp',
        packing: 'chunked',
        chunkSize: 24,
        chunks: [
          {
            index: 0,
            startFrame: 0,
            endFrame: 23,
            src: 'chunk_0.bin',
            framesCount: 24,
          },
        ],
      },
      {
        id: 'mobile',
        minWidth: 0,
        maxWidth: 1023,
        width: 960,
        height: 540,
        format: 'image/webp',
        packing: 'individual',
        frames: [
          { id: 0, src: 'f_00.webp' },
          { id: 1, src: 'f_01.webp' },
        ],
      },
    ],
    motion: {
      defaultEasing: 'linear',
      lut: [0.0, 0.2, 0.5, 0.8, 1.0],
    },
  };

  it('validates a compliant manifest without errors', () => {
    const result = validateManifest(validManifest);
    expect(result.id).toBe('test-animation');
    expect(result.variants.length).toBe(2);
  });

  it('throws an error if version is not 1.0.0', () => {
    const invalid = { ...validManifest, version: '2.0.0' };
    expect(() => validateManifest(invalid)).toThrow(/Unsupported manifest version/);
  });

  it('throws an error if variants array is empty', () => {
    const invalid = { ...validManifest, variants: [] };
    expect(() => validateManifest(invalid)).toThrow(/at least one resolution variant/);
  });

  it('throws an error if motion LUT is non-monotonic', () => {
    const invalid = {
      ...validManifest,
      motion: { lut: [0.0, 0.5, 0.3, 1.0] }, // 0.3 < 0.5
    };
    expect(() => validateManifest(invalid)).toThrow(/monotonically non-decreasing/);
  });

  it('selects desktop variant on large screens with DPR 1.0', () => {
    const variant = selectVariant(validManifest, 1440, 1.0);
    expect(variant.id).toBe('desktop');
    expect(variant.width).toBe(1920);
  });

  it('selects desktop variant at 1920x1080 even with DPR 1.5 and DPR 2.0', () => {
    const v1 = selectVariant(validManifest, 1920, 1.0);
    expect(v1.id).toBe('desktop');
    const v15 = selectVariant(validManifest, 1920, 1.5);
    expect(v15.id).toBe('desktop');
    const v2 = selectVariant(validManifest, 1920, 2.0);
    expect(v2.id).toBe('desktop');
  });

  it('selects mobile variant at 390x844 (mobile viewport)', () => {
    const vMobile = selectVariant(validManifest, 390, 2.0);
    expect(vMobile.id).toBe('mobile');
    expect(vMobile.width).toBe(960);
  });

  it('validates individual variant with compact frameTemplate', () => {
    const compactManifest: AnimationManifest = {
      version: '1.0.0',
      id: 'compact-test',
      metadata: {
        totalFrames: 300,
        fps: 30,
        duration: 10,
        aspectRatio: '16:9',
      },
      variants: [
        {
          id: 'desktop',
          minWidth: 0,
          width: 1920,
          height: 1080,
          format: 'image/webp',
          packing: 'individual',
          frameTemplate: 'frames/f_%04d.webp',
          framesCount: 300,
        },
      ],
    };

    const validated = validateManifest(compactManifest);
    expect(validated.variants[0].frameTemplate).toBe('frames/f_%04d.webp');
  });

  it('validates a compiler-produced manifest against schema/v1.json', async () => {
    const repoRoot = path.resolve(__dirname, '..');
    const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schema', 'v1.json'), 'utf-8'));

    const workDir = path.join(repoRoot, '.artifacts', 'schema-test');
    const clipPath = path.join(workDir, 'clip.mp4');
    const outDir = path.join(workDir, 'out');
    fs.mkdirSync(workDir, { recursive: true });

    try {
      await runFFmpeg([
        '-y',
        '-f', 'lavfi',
        '-i', 'testsrc=duration=0.25:size=160x90:rate=12',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        clipPath,
      ]);

      const manifest = await compile({
        input: clipPath,
        outputDir: outDir,
        fps: 12,
        variants: [{ id: 'desktop', width: 160, height: 90, minWidth: 0 }],
      });

      expect(manifest.$schema).toBe(schema.$id);
      for (const reqKey of schema.required as string[]) {
        expect(manifest).toHaveProperty(reqKey);
      }
      for (const key of Object.keys(manifest)) {
        expect(schema.properties).toHaveProperty(key);
      }
      expect(manifest.version).toBe(schema.properties.version.const);

      for (const reqMeta of schema.properties.metadata.required as string[]) {
        expect(manifest.metadata).toHaveProperty(reqMeta);
      }
      for (const key of Object.keys(manifest.metadata)) {
        expect(schema.properties.metadata.properties).toHaveProperty(key);
      }

      const variantDef = schema.$defs.ResolutionVariant;
      for (const v of manifest.variants) {
        for (const reqVar of variantDef.required as string[]) {
          expect(v).toHaveProperty(reqVar);
        }
        for (const key of Object.keys(v)) {
          expect(variantDef.properties).toHaveProperty(key);
        }
        expect(schema.$defs.PackingMode.enum).toContain(v.packing);
      }

      expect(() => validateManifest(manifest)).not.toThrow();

      const ajv = new Ajv2020({ allErrors: true, strict: false });
      const ajvValidate = ajv.compile(schema);
      expect(ajvValidate(manifest), JSON.stringify(ajvValidate.errors)).toBe(true);

      // Negative case: missing required metadata.fps and unknown top-level property must fail schema validation
      const invalidManifest = {
        ...manifest,
        metadata: { totalFrames: 3, duration: 0.25, aspectRatio: '16:9' },
        unexpectedExtraField: true,
      };
      expect(ajvValidate(invalidManifest)).toBe(false);
    } finally {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }
  });
});
