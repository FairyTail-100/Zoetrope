# @zoetropejs/compiler

Asset compiler, manifest validator, and `zoetrope` CLI for converting video files into multi-resolution WebP/AVIF/JPEG frame sequences.

## Installation

> Not yet published to npm. Run directly from the workspace or install the packed tarball from `dist-release/`:

```bash
pnpm zoetrope doctor
pnpm zoetrope compile input.mp4 --out ./public/assets/hero --fps 24
```

## Programmatic Usage

```typescript
import { compile, validateManifestFile } from '@zoetropejs/compiler';

const manifest = await compile({
  input: './clip.mp4',
  outputDir: './public/assets/hero',
  fps: 24,
});

const result = await validateManifestFile('./public/assets/hero/manifest.json', { deep: true });
```

## Documentation

- [Compiler Reference](../../documentation/compiler.md)
- [Root README](../../README.md)
