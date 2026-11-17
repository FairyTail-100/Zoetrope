# @zoetrope/core

Runtime engine for Zoetrope: bidirectional scroll-driven HTML5 Canvas video playback (`Zoetrope`) and multi-layer timeline/mask composition (`ZoetropeComposition`).

## Installation

> Not yet published to npm. Build locally with `pnpm pack:all` and install the standalone tarball (which bundles all internal dependencies):

```bash
pnpm add file:./dist-release/zoetrope-core-0.1.0-rc.1.tgz
```

## Minimal Usage

```typescript
import { Zoetrope } from '@zoetrope/core';

const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;
const engine = new Zoetrope({
  manifest: '/assets/hero/manifest.json',
  canvas,
  renderer: { fit: 'cover' },
});

await engine.init();
window.addEventListener('beforeunload', () => engine.destroy());
```

## Documentation

- [Root README](../../README.md)
- [Integration Guide](../../documentation/integration-guide.md)
- [Feature Status](../../documentation/feature-status.md)
