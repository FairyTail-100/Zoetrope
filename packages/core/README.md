# @zoetropejs/core

Runtime engine for ZoetropeJS: bidirectional scroll-driven HTML5 Canvas video playback (`ZoetropeJS`) and multi-layer timeline/mask composition (`ZoetropeComposition`).

## Installation

```bash
npm i @zoetropejs/core@next
```

## Minimal Usage

```typescript
import { ZoetropeJS } from '@zoetropejs/core';

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
