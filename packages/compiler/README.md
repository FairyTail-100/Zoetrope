# @zoetropejs/compiler

Asset compiler, manifest validator, and `zoetrope` CLI for converting video files into multi-resolution WebP/AVIF/JPEG frame sequences.

## Installation

```bash
npm i @zoetropejs/compiler@next
npx @zoetropejs/compiler doctor
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
