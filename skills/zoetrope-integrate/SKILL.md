---
name: zoetrope-integrate
description: Embedding the scroll player in web frameworks (Vanilla JS, React, Next.js SSR-safe, Astro). Use when wiring the engine to a canvas or component.
---

# Engine Framework Integration

Embed Zoetrope in any web runtime using its HTML5 canvas renderer.

## Package Installation

In your consumer application, install `@zoetrope/core`:
```bash
# Portable vendor tarballs from dist-release/:
pnpm add file:./vendor/zoetrope-core-<version>.tgz

# Or after npm publishing (unverified until published):
pnpm add @zoetrope/core
```

## 1. Vanilla HTML / Canvas

```typescript
import { Zoetrope } from '@zoetrope/core';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;

// Support ?manifest= query param override
const urlParams = new URLSearchParams(window.location.search);
const manifestUrl = urlParams.get('manifest') 
  ? decodeURIComponent(urlParams.get('manifest')!) 
  : '/assets/hero/manifest.json';

const engine = new Zoetrope({
  manifest: manifestUrl,
  canvas,
  renderer: { fit: 'cover' },
  cache: {
    maxMemoryBytes: 128 * 1024 * 1024
  }
});

await engine.init();

// Always destroy on teardown to release bitmaps and RAF handles
window.addEventListener('beforeunload', () => {
  engine.destroy();
});
```

## 2. React Component (`@zoetrope/react`)

```tsx
import React from 'react';
import { NextZoetropePlayer } from '@zoetrope/react';

export function HeroScroll() {
  return (
    <div style={{ height: '300vh', position: 'relative' }}>
      <div style={{ position: 'sticky', top: 0, width: '100vw', height: '100vh' }}>
        <NextZoetropePlayer
          options={{
            manifest: '/assets/hero/manifest.json',
            renderer: { fit: 'cover' }
          }}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
```

## 3. Next.js App Router (SSR-Safe)

Always use `next/dynamic` with `{ ssr: false }` to avoid canvas hydration issues on the server:

```tsx
import dynamic from 'next/dynamic';

const NextZoetropePlayer = dynamic(
  () => import('@zoetrope/react').then((mod) => mod.NextZoetropePlayer),
  { ssr: false }
);
```

## Canvas Requirements & Teardown

- **CSS Styling**: Set explicit CSS width and height (`width: 100%; height: 100%; display: block;`). The engine automatically manages `canvas.width` and `canvas.height` accounting for `window.devicePixelRatio`.
- **Teardown**: Always call `engine.destroy()` on component unmount to flush decoded bitmaps and remove scroll listeners.

## Detailed Framework Reference

For Astro and advanced lifecycle examples:
👉 [references/framework-adapters.md](references/framework-adapters.md)
