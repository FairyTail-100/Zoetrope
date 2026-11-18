---
name: zoetrope-compose
description: Multi-track layering, iris masks, scroll windows, and DOM cue orchestration. Use when composing multiple video tracks or syncing canvas masks with scroll progress.
---

# Layered Composition & DOM Cues

The `ZoetropeComposition` coordinator orchestrates multiple video sequences on a single canvas, managing shared memory budgets, z-ordering, iris circular masks, and scroll-synced DOM cues.

## Basic Multi-Layer Setup

```typescript
import { ZoetropeComposition, CompositionLayerConfig, Cue } from '@zoetropejs/core';

const canvas = document.querySelector<HTMLCanvasElement>('#composition-canvas')!;

const layers: CompositionLayerConfig[] = [
  {
    id: 'background-base',
    manifest: '/assets/background/manifest.json',
    scrollRange: [0.0, 0.8],
    zIndex: 1,
    priority: 2, // 2x share of cache budget
    opacity: [
      { progress: 0.0, value: 1.0 },
      { progress: 0.8, value: 0.0, easing: 'easeOut' }
    ]
  },
  {
    id: 'iris-overlay',
    manifest: '/assets/foreground/manifest.json',
    scrollRange: [0.2, 1.0],
    zIndex: 2,
    mask: {
      type: 'circle',
      x: 0.5,
      y: 0.5,
      radius: [
        { progress: 0.2, value: 0.0 },
        { progress: 0.6, value: 0.4, easing: 'easeInOut' },
        { progress: 1.0, value: 1.0 }
      ]
    }
  }
];

const cues: Cue[] = [
  {
    id: 'headline-reveal',
    start: 0.25,
    end: 0.55,
    onEnter: () => document.body.classList.add('act-visible'),
    onLeave: () => document.body.classList.remove('act-visible'),
    onProgress: (localProgress) => {
      // localProgress normalized [0.0 - 1.0] across cue window
      const el = document.querySelector<HTMLElement>('#progress-bar');
      if (el) el.style.transform = `scaleX(${localProgress})`;
    }
  }
];

const composition = new ZoetropeComposition({
  canvas,
  layers,
  cues,
  totalMemoryMb: 256
});

// Teardown
window.addEventListener('beforeunload', () => {
  composition.destroy();
});
```

## Iris Masking Rules

- **Origin Coordinates (`x`, `y`)**: Normalized `[0.0, 1.0]` where `(0.5, 0.5)` is canvas center.
- **Radius**: Normalized to `Math.hypot(canvas.width, canvas.height) / 2` so `1.0` guarantees full-canvas coverage at all aspect ratios.
- **Keyframe Interpolation**: Supports `linear`, `easeIn`, `easeOut`, `easeInOut`.

## Working Reference

Inspect the full implementation in the repository:
👉 [examples/layered-composition/src/main.ts](../../examples/layered-composition/src/main.ts)

