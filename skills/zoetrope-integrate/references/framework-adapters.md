# Framework Integration Reference

Detailed component snippets for React, Next.js (SSR-safe), and Astro.

## 1. Next.js App Router (SSR-Safe Dynamic Import)

Because HTML Canvas and `window.matchMedia` require a browser runtime, Next.js components must use dynamic loading with `ssr: false`:

```tsx
// components/ZoetropeScrollPlayer.tsx
'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const PlayerInternal = dynamic(
  () => import('@zoetropejs/react').then((mod) => mod.NextZoetropePlayer),
  { ssr: false }
);

export function ZoetropeScrollPlayer({ manifestUrl }: { manifestUrl: string }) {
  return (
    <div style={{ height: '300vh', position: 'relative' }}>
      <div style={{ position: 'sticky', top: 0, width: '100vw', height: '100vh' }}>
        <PlayerInternal
          options={{
            manifest: manifestUrl,
            renderer: { fit: 'cover' }
          }}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
```

## 2. Astro Component Integration

In Astro, use `client:only="react"` or vanilla script tags:

```astro
---
// src/components/HeroVideo.astro
interface Props {
  manifestUrl: string;
}
const { manifestUrl } = Astro.props;
---
<div class="scroll-wrapper" style="height: 300vh; position: relative;">
  <div style="position: sticky; top: 0; width: 100vw; height: 100vh;">
    <canvas id="zoetrope-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
  </div>
</div>

<script>
  import { ZoetropeJS } from '@zoetropejs/core';

  const canvas = document.getElementById('zoetrope-canvas') as HTMLCanvasElement;
  if (canvas) {
    const engine = new Zoetrope({
      manifest: '/assets/hero/manifest.json',
      canvas,
      renderer: { fit: 'cover' }
    });

    await engine.init();

    window.addEventListener('beforeunload', () => {
      engine.destroy();
    });
  }
</script>
```

